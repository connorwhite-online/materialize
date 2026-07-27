import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Re-attempts refunds that failed during an auto-approved-order
 * cancellation. `cancelAutoApprovedOrder` cancels the order, then tries
 * to refund the off-session charge; if Stripe is briefly unavailable the
 * order would otherwise be left cancelled-but-charged. That path now sets
 * `refundFailedAt`, and this sweep clears it once the refund succeeds.
 *
 * Safety: the refund is issued with the SAME deterministic idempotency
 * key as the original attempt (`agent-cancel-refund:<orderId>`), so if the
 * original actually went through (and only the bookkeeping failed) Stripe
 * dedupes — we never double-refund.
 *
 * Escalation: a refund still failing after 24h is logged as an error so it
 * surfaces in Sentry for manual intervention; it stays flagged for the
 * next sweep regardless.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 * Wired in vercel.json (hourly). Run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/retry-failed-refunds
 */

const ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logError(
      "cron/retry-failed-refunds.auth",
      new Error("CRON_SECRET not configured")
    );
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    logError(
      "cron/retry-failed-refunds.auth",
      new Error("Unauthorized cron request")
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stuck = await db
      .select({
        id: printOrders.id,
        stripeSessionId: printOrders.stripeSessionId,
        refundFailedAt: printOrders.refundFailedAt,
      })
      .from(printOrders)
      .where(isNotNull(printOrders.refundFailedAt));

    const stripe = getStripe();
    let recovered = 0;
    let stillFailing = 0;

    for (const order of stuck) {
      // No PaymentIntent recorded → nothing we can refund automatically.
      // Clear the flag and escalate so a human can reconcile.
      if (!order.stripeSessionId) {
        logError(
          "cron/retry-failed-refunds:noPaymentIntent",
          new Error(`order ${order.id} flagged refundFailed but has no payment id`)
        );
        await db
          .update(printOrders)
          .set({ refundFailedAt: null })
          .where(eq(printOrders.id, order.id));
        continue;
      }

      try {
        await stripe.refunds.create(
          {
            payment_intent: order.stripeSessionId,
            reason: "requested_by_customer",
            metadata: { printOrderId: order.id, source: "agent_auto_cancel_retry" },
          },
          { idempotencyKey: `agent-cancel-refund:${order.id}` }
        );
        await db
          .update(printOrders)
          .set({ refundFailedAt: null })
          .where(eq(printOrders.id, order.id));
        recovered++;
      } catch (err) {
        stillFailing++;
        const ageMs = order.refundFailedAt
          ? Date.now() - order.refundFailedAt.getTime()
          : 0;
        if (ageMs > ESCALATE_AFTER_MS) {
          logError(
            "cron/retry-failed-refunds:escalation",
            new Error(
              `refund for order ${order.id} still failing after 24h — needs manual reconciliation`
            )
          );
        } else {
          logError("cron/retry-failed-refunds", err);
        }
      }
    }

    const result = { scanned: stuck.length, recovered, stillFailing };
    console.log("[cron/retry-failed-refunds] swept", result);
    return Response.json(result);
  } catch (error) {
    logError("cron/retry-failed-refunds", error);
    return Response.json({ error: "Retry sweep failed" }, { status: 500 });
  }
}
