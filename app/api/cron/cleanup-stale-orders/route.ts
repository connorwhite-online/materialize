import { db } from "@/lib/db";
import {
  cartItems,
  printOrders,
  webhookEventsProcessed,
} from "@/lib/db/schema";
import { and, eq, like, lt } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Daily housekeeping sweeps. The path name predates the broader
 * scope (it began as just the stale-order cancel) — keeping it so
 * the vercel.json cron entry stays stable.
 *
 * Three independent tasks, fired in parallel:
 *
 *   1. **Stale print orders** — `cart_created` rows older than 48h
 *      get flipped to `cancelled`. They land here when the user
 *      closed the tab between createPrintOrder and completePrintOrder,
 *      when Stripe checkout never opened, or when the chain partially
 *      failed. 48h is generous: real checkouts complete in seconds
 *      and a Stripe Checkout session expires after 24h.
 *
 *   2. **Stale cart items** — `cart_items` rows older than 7 days
 *      get hard-deleted. The `quoteId` on each is stale long before
 *      this (CraftCloud quotes age out in hours), so the user would
 *      hit a re-quote flow at checkout anyway — better to clear them
 *      proactively than render a cart full of expired numbers.
 *
 *   3. **Webhook event dedup prune** — `webhook_events_processed`
 *      rows older than 30 days get hard-deleted. Stripe stops
 *      retrying after a few days, so 30d is well past any legitimate
 *      retry window. Without pruning the table grows unboundedly.
 *
 * Auth: when Vercel cron triggers this route it includes
 * `Authorization: Bearer ${CRON_SECRET}`. Without that header (or
 * with a wrong value) we 401.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/cleanup-stale-orders
 */

const STALE_ORDER_AGE_MS = 48 * 60 * 60 * 1000;
const STALE_CART_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_DEDUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// The stale-order pass is serial (refund, then cancel, per row) and
// previously had no cap — an unbounded backlog could run past the
// function's wall-clock limit with zero signal (see MTR-144). 200 rows
// at up to ~2s/row (a Stripe refund call plus the DB update) is ~400s
// worst case, which is why maxDuration below is sized to match; any
// remainder is picked up by tomorrow's run (`hasMoreStaleOrders` in the
// response makes a growing backlog visible before it becomes a crisis).
const STALE_ORDER_LIMIT = 200;

// Worst case ~200 serial refund+cancel calls (see STALE_ORDER_LIMIT)
// at up to ~2s each ≈ 400s; 300s (the platform's default Pro-plan
// ceiling) covers the common case. A run that hits the ceiling still
// leaves partial progress — every write is per-row and unconditional
// only after its own refund attempt completes — so a mid-sweep kill
// just means more rows for tomorrow, not a double-refund.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = Date.now();
    const orderCutoff = new Date(now - STALE_ORDER_AGE_MS);
    const cartCutoff = new Date(now - STALE_CART_AGE_MS);
    const webhookCutoff = new Date(now - WEBHOOK_DEDUP_RETENTION_MS);

    type OpResult = number | "error";
    let cancelledOrders: OpResult = "error";
    let deletedCartItems: OpResult = "error";
    let prunedWebhookEvents: OpResult = "error";
    let hasMoreStaleOrders = false;

    try {
      // CON-159: Rows with a `pi_`-prefixed stripeSessionId are
      // off-session auto-approved orders where the customer was already
      // charged. Cancel them only after attempting a refund so we never
      // silently abandon a charged-but-unplaced order.
      //
      // We split the operation into two passes:
      //   1. Charged rows (pi_ stripeSessionId): refund first, then cancel.
      //   2. Uncharged rows: cancel directly.
      // Fetch one row past the cap so we can tell whether there's a
      // remainder without a separate COUNT query.
      const fetchedRows = await db
        .select({
          id: printOrders.id,
          stripeSessionId: printOrders.stripeSessionId,
        })
        .from(printOrders)
        .where(
          and(
            eq(printOrders.status, "cart_created"),
            lt(printOrders.createdAt, orderCutoff)
          )
        )
        .limit(STALE_ORDER_LIMIT + 1);

      hasMoreStaleOrders = fetchedRows.length > STALE_ORDER_LIMIT;
      const staleRows = hasMoreStaleOrders
        ? fetchedRows.slice(0, STALE_ORDER_LIMIT)
        : fetchedRows;

      const stripe = getStripe();
      let cancelled = 0;

      for (const row of staleRows) {
        const isChargedRow =
          typeof row.stripeSessionId === "string" &&
          row.stripeSessionId.startsWith("pi_");

        if (isChargedRow) {
          // The order was charged via off-session PI but never placed.
          // Issue a refund before cancelling. On refund failure, still
          // cancel but set refundFailedAt so retry-failed-refunds picks it up.
          let refundFailedAt: Date | null = null;
          try {
            await stripe.refunds.create(
              {
                payment_intent: row.stripeSessionId!,
                reason: "requested_by_customer",
                metadata: {
                  printOrderId: row.id,
                  source: "cleanup_stale_charged",
                },
              },
              { idempotencyKey: `agent-cancel-refund:${row.id}` }
            );
          } catch (refundErr) {
            logError("cron/cleanup-stale-orders.refundCharged", refundErr);
            refundFailedAt = new Date();
          }
          await db
            .update(printOrders)
            .set({ status: "cancelled", refundFailedAt })
            .where(eq(printOrders.id, row.id));
        } else {
          // No charge — safe to cancel without refund.
          await db
            .update(printOrders)
            .set({ status: "cancelled" })
            .where(eq(printOrders.id, row.id));
        }
        cancelled++;
      }

      cancelledOrders = cancelled;
    } catch (err) {
      logError("cron/cleanup-stale-orders.cancelOrders", err);
    }

    try {
      const rows = await db
        .delete(cartItems)
        .where(lt(cartItems.updatedAt, cartCutoff))
        .returning({ id: cartItems.id });
      deletedCartItems = rows.length;
    } catch (err) {
      logError("cron/cleanup-stale-orders.deleteCartItems", err);
    }

    try {
      const rows = await db
        .delete(webhookEventsProcessed)
        .where(lt(webhookEventsProcessed.processedAt, webhookCutoff))
        .returning({ id: webhookEventsProcessed.id });
      prunedWebhookEvents = rows.length;
    } catch (err) {
      logError("cron/cleanup-stale-orders.pruneWebhookEvents", err);
    }

    const anyFailed =
      cancelledOrders === "error" ||
      deletedCartItems === "error" ||
      prunedWebhookEvents === "error";

    const result = {
      cancelledOrders,
      deletedCartItems,
      prunedWebhookEvents: prunedWebhookEvents,
      hasMoreStaleOrders,
      cutoffs: {
        orders: orderCutoff.toISOString(),
        cartItems: cartCutoff.toISOString(),
        webhookEvents: webhookCutoff.toISOString(),
      },
    };
    console.log("[cron/cleanup-stale-orders] swept", result);

    if (anyFailed) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    logError("cron/cleanup-stale-orders", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
