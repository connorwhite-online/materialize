import "server-only";
import { db } from "@/lib/db";
import { printOrders, printOrderItems, cartItems } from "@/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createOrder } from "@/lib/craftcloud/client";
import { logError } from "@/lib/logger";
import { notifyPrintOrderPlaced } from "@/lib/notifications/print-order";

/**
 * Fires after a successful Stripe `checkout.session.completed`
 * event. What "successful" means depends on the order's persisted
 * `checkoutModel` (the row value, never the CHECKOUT_MODEL env var,
 * so flipping the env can't strand in-flight orders):
 *
 *   - "single"   — the user paid print + shipping + fee in full; we
 *     place the real CraftCloud order so production starts. The
 *     atomic-claim machinery below guards that placement.
 *   - "two_step" — the session only AUTHORIZED the 3% service fee
 *     (capture_method: "manual"); the CraftCloud order was already
 *     placed up-front by completePrintOrder. See
 *     handleTwoStepFeeAuthorization.
 *
 * Idempotency is critical: Stripe retries any non-2xx and will
 * also fire duplicate deliveries on network hiccups. The hardened
 * model uses an atomic claim:
 *
 *   1. **Claim phase** — try to UPDATE the row to a per-call
 *      `placing:<nanoid>` sentinel, gated on `status='cart_created'
 *      AND craftCloudOrderId IS NULL`. If 0 rows are returned,
 *      another worker is already handling this order (or it's
 *      already done — re-fetch to decide).
 *
 *   2. **Place phase** — only the worker holding the claim calls
 *      CraftCloud. On success we write the real `craftCloudOrderId`
 *      and advance status. On failure we release the claim
 *      (NULL out the sentinel) so the next webhook retry can try
 *      again cleanly.
 *
 * Reentry semantics:
 *   - status advanced past cart_created → done, no-op.
 *   - real (non-sentinel) craftCloudOrderId present → "Guard #2"
 *     heal-status path, preserved for orders placed before this
 *     code shipped.
 *   - sentinel value present → another worker is mid-flight.
 *     Bail (the active worker's success or release will resolve).
 *     Logged at warn level so persistently-stuck orders surface.
 *
 * Residual risk: if the active worker dies *between* createOrder
 * succeeding and the final UPDATE committing, the order is stuck
 * with a sentinel and a real order at CraftCloud we can't see.
 * Recovery requires reconciling against CraftCloud's cart→order
 * lookup — out of scope for this handler; surfaced via the warn log.
 */

const CLAIM_PREFIX = "placing:";

function isClaimSentinel(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(CLAIM_PREFIX);
}

/**
 * MONEY-2: `checkoutVendorGroup` deliberately leaves `cartItems` rows
 * in place (see its docstring in app/actions/print.ts) so an
 * abandoned checkout doesn't lose the cart. This is the other half —
 * once an order has actually placed, clear the cart lines it came
 * from.
 *
 * `printOrderItems` doesn't store the source `cartItems.id` (no
 * schema change for this fix), so rows are matched back via the same
 * (fileAssetId, quoteId) pair the cartItems unique index already
 * keys on — each cart line's quoteId is a fresh CraftCloud quote, so
 * this can't accidentally sweep up an unrelated item a user added
 * after abandoning an earlier checkout attempt for the same file.
 *
 * Single-file orders from `createPrintOrder` (the non-cart "Print
 * with X" flow) never write `printOrderItems`, so they no-op here —
 * nothing to clear.
 *
 * Idempotent and best-effort by design: called from every branch that
 * observes (or just achieved) an "ordered" status, including retries.
 * Deleting already-deleted rows matches 0 rows and doesn't error. A
 * failure here is logged, never thrown — the order placement it runs
 * after must not be rolled back or retried over a cart-cleanup blip.
 */
async function clearCartItemsForOrder(
  printOrderId: string,
  userId: string
): Promise<void> {
  try {
    const orderItems = await db
      .select({
        fileAssetId: printOrderItems.fileAssetId,
        quoteId: printOrderItems.quoteId,
      })
      .from(printOrderItems)
      .where(eq(printOrderItems.printOrderId, printOrderId));

    if (orderItems.length === 0) return;

    await db.delete(cartItems).where(
      and(
        eq(cartItems.userId, userId),
        or(
          ...orderItems.map((i) =>
            and(
              eq(cartItems.fileAssetId, i.fileAssetId),
              eq(cartItems.quoteId, i.quoteId)
            )
          )
        )
      )
    );
  } catch (err) {
    logError("handlePrintOrderPayment.clearCartItems", err);
  }
}

export async function handlePrintOrderPayment(
  printOrderId: string,
  opts?: { paymentIntentId?: string }
): Promise<void> {
  // Fetch-first purely to branch on the persisted checkout model —
  // the single-mode claim below still re-checks everything it gates
  // on atomically, so this read introduces no TOCTOU risk.
  const [existing] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, printOrderId));

  if (existing?.checkoutModel === "two_step") {
    await handleTwoStepFeeAuthorization(printOrderId, opts?.paymentIntentId);
    return;
  }

  // Single-checkout model from here down. (A missing row also falls
  // through — the claim flow's own guards produce the original
  // "Print order not found" / release semantics.)
  const sentinel = `${CLAIM_PREFIX}${nanoid()}`;

  // Atomic claim: only succeeds if the row is still in the pristine
  // pre-place state. Returning empty means another path applies —
  // the re-fetch below decides which.
  const claimed = await db
    .update(printOrders)
    .set({ craftCloudOrderId: sentinel })
    .where(
      and(
        eq(printOrders.id, printOrderId),
        eq(printOrders.status, "cart_created"),
        isNull(printOrders.craftCloudOrderId)
      )
    )
    .returning({ id: printOrders.id });

  if (claimed.length === 0) {
    const [order] = await db
      .select()
      .from(printOrders)
      .where(eq(printOrders.id, printOrderId));

    if (!order) {
      throw new Error(`Print order not found: ${printOrderId}`);
    }

    // Guard #1 — status advanced. Pure duplicate delivery. If an
    // earlier delivery placed the order but died before clearing the
    // cart (MONEY-2), this retry is what finishes the job — idempotent,
    // so re-running it on a delivery that already cleared is a no-op.
    if (order.status !== "cart_created") {
      if (order.status === "ordered") {
        await clearCartItemsForOrder(printOrderId, order.userId);
      }
      return;
    }

    // Another worker holds an active claim. Stay out of their way.
    if (isClaimSentinel(order.craftCloudOrderId)) {
      logError("handlePrintOrderPayment.reentryAgainstActiveClaim", new Error(
        `reentry against active claim for order ${printOrderId} (sentinel: ${order.craftCloudOrderId})`
      ));
      return;
    }

    // Guard #2 — real id from a previous successful place. Heal status.
    if (order.craftCloudOrderId) {
      await db
        .update(printOrders)
        .set({ status: "ordered" })
        .where(eq(printOrders.id, printOrderId));
      await clearCartItemsForOrder(printOrderId, order.userId);
    }
    return;
  }

  // We hold the claim — re-fetch the row for cart + address.
  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, printOrderId));

  if (!order || !order.craftCloudCartId || !order.shippingAddress) {
    await releaseClaim(printOrderId, sentinel);
    throw new Error(`Missing cart or address for order: ${printOrderId}`);
  }

  const addr = order.shippingAddress;

  let ccOrderId: string;
  try {
    const ccOrder = await createOrder({
      cartId: order.craftCloudCartId,
      user: {
        emailAddress: addr.email,
        shipping: addr.shipping,
        billing: addr.billing,
      },
    });
    ccOrderId = ccOrder.orderId;
  } catch (err) {
    await releaseClaim(printOrderId, sentinel);
    throw err;
  }

  // Conditional write — only swap our sentinel for the real id.
  // Belt-and-suspenders: if a parallel actor (e.g. operator manually
  // editing the row) has already moved past us, leave their state alone.
  const placed = await db
    .update(printOrders)
    .set({ craftCloudOrderId: ccOrderId, status: "ordered" })
    .where(
      and(
        eq(printOrders.id, printOrderId),
        eq(printOrders.craftCloudOrderId, sentinel)
      )
    )
    .returning({ id: printOrders.id });

  // MTR-230: a zero-row result here means we placed a PAID vendor
  // order whose id we never persisted — reconcile can't find it and
  // cleanup may cancel-and-refund it out from under CraftCloud. The
  // sibling reentry race above (line ~114) already logs; this closes
  // the same gap on the write side. No control-flow change — the
  // notify guard below is untouched.
  if (placed.length === 0) {
    logError(
      "handlePrintOrderPayment.placeWriteLost",
      new Error(
        `CraftCloud order created but write lost for order ${printOrderId}`,
        { cause: { printOrderId, craftCloudOrderId: ccOrderId } }
      )
    );
  }

  // Fire creator notifications iff WE were the writer (sentinel still
  // matched). Otherwise a parallel worker already ran or is running
  // through this same path and would notify on its own. Helper
  // swallows its own errors so a downstream blip can't roll back the
  // order placement we just committed.
  if (placed.length > 0) {
    await notifyPrintOrderPlaced(printOrderId);
  }

  // MONEY-2: clear the cart lines this order came from now that it has
  // actually placed. Best-effort/idempotent, and deliberately run
  // whether or not WE were the writer above — if a parallel worker won
  // the placement race, the cart still needs clearing exactly once,
  // and clearCartItemsForOrder is a no-op the second time either way.
  await clearCartItemsForOrder(printOrderId, order.userId);
}

/**
 * Two-step model: the completed Checkout session only AUTHORIZED the
 * 3% service fee under `capture_method: "manual"` — no money has
 * moved, and nothing is owed to anyone yet. The CraftCloud order was
 * already placed (unpaid) up-front by completePrintOrder, and the
 * customer still has to pay CraftCloud directly via the bridge
 * session. So this branch makes NO CraftCloud call, takes NO claim
 * sentinel, and sends NO notifyPrintOrderPlaced — the reconciliation
 * cron notifies when it captures the fee after CraftCloud payment
 * confirms.
 *
 * All we record is "the fee hold exists": advance the row to
 * awaiting_production_payment and stash the PaymentIntent id the
 * cron will later capture. Idempotency is a single conditional
 * UPDATE gated on status='cart_created' — a duplicate Stripe
 * delivery (or an order that already advanced) matches 0 rows and
 * silently no-ops.
 */
async function handleTwoStepFeeAuthorization(
  printOrderId: string,
  paymentIntentId: string | undefined
): Promise<void> {
  if (paymentIntentId === undefined) {
    throw new Error(
      `handleTwoStepFeeAuthorization: missing paymentIntentId for order ${printOrderId} — cannot advance without a PI to capture`
    );
  }
  const updated = await db
    .update(printOrders)
    .set({
      status: "awaiting_production_payment",
      feePaymentIntentId: paymentIntentId,
      feeAuthorizedAt: new Date(),
    })
    .where(
      and(
        eq(printOrders.id, printOrderId),
        eq(printOrders.status, "cart_created")
      )
    )
    .returning({ id: printOrders.id });

  // MTR-230: zero rows is ambiguous — a benign duplicate Stripe
  // delivery (the row already advanced past cart_created) or a row
  // that landed in some OTHER unexpected status, in which case
  // feePaymentIntentId is never recorded and the manual-capture 3%
  // fee hold silently expires uncaptured. Re-read to tell them apart;
  // only the latter is worth paging on — response/return semantics
  // are unchanged either way.
  if (updated.length === 0) {
    const [current] = await db
      .select({ status: printOrders.status })
      .from(printOrders)
      .where(eq(printOrders.id, printOrderId));
    if (current?.status !== "awaiting_production_payment") {
      logError(
        "handlePrintOrderPayment.twoStepFeeNoOp",
        new Error(
          `two-step fee authorization write lost for order ${printOrderId}`,
          { cause: { printOrderId, status: current?.status } }
        )
      );
    }
  }
}

async function releaseClaim(
  printOrderId: string,
  sentinel: string
): Promise<void> {
  try {
    await db
      .update(printOrders)
      .set({ craftCloudOrderId: null })
      .where(
        and(
          eq(printOrders.id, printOrderId),
          eq(printOrders.craftCloudOrderId, sentinel)
        )
      );
  } catch (err) {
    // Releasing is best-effort. A stuck claim won't double-place
    // (the next reentry's atomic claim still gates on IS NULL), but
    // the row will need manual cleanup. Log loudly.
    logError("handlePrintOrderPayment.releaseClaim", err);
  }
}
