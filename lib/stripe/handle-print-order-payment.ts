import "server-only";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createOrder } from "@/lib/craftcloud/client";
import { logError } from "@/lib/logger";

/**
 * Fires after a successful Stripe `checkout.session.completed`
 * event — the user has paid, and we need to place the real
 * CraftCloud order so production starts.
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

export async function handlePrintOrderPayment(
  printOrderId: string
): Promise<void> {
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

    // Guard #1 — status advanced. Pure duplicate delivery.
    if (order.status !== "cart_created") return;

    // Another worker holds an active claim. Stay out of their way.
    if (isClaimSentinel(order.craftCloudOrderId)) {
      console.warn("[handlePrintOrderPayment] reentry against active claim", {
        printOrderId,
        sentinel: order.craftCloudOrderId,
      });
      return;
    }

    // Guard #2 — real id from a previous successful place. Heal status.
    if (order.craftCloudOrderId) {
      await db
        .update(printOrders)
        .set({ status: "ordered" })
        .where(eq(printOrders.id, printOrderId));
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
  await db
    .update(printOrders)
    .set({ craftCloudOrderId: ccOrderId, status: "ordered" })
    .where(
      and(
        eq(printOrders.id, printOrderId),
        eq(printOrders.craftCloudOrderId, sentinel)
      )
    );
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
