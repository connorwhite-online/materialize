import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { getOrderStatus } from "@/lib/craftcloud/client";
import { isProductionPaymentConfirmed } from "@/lib/craftcloud/payment-confirmation";
import { notifyPrintOrderPlaced } from "@/lib/notifications/print-order";
import { logError } from "@/lib/logger";

/**
 * How long a two-step order may sit in `awaiting_production_payment`
 * before we treat it as abandoned and release the service-fee hold
 * (CON-118).
 *
 * 72h is deliberately well inside Stripe's ~7-day authorization
 * window: a manual-capture PaymentIntent auto-expires (Stripe cancels
 * it and releases the hold) roughly 7 days after authorization, so we
 * must give up — and cancel cleanly ourselves — long before Stripe
 * would do it for us. If this cron misses an order entirely, Stripe's
 * auto-expiry is the backstop, and the next sweep observes the PI as
 * `canceled` and finalizes the row (see the terminal-abandonment
 * branch below). The hold is never charged, so there is nothing to
 * refund on abandonment.
 */
export const ABANDONMENT_TTL_MS = 72 * 60 * 60 * 1000;

export interface ReconcileResult {
  /** Fees captured (or healed as already-captured) — order is real. */
  captured: number;
  /** Holds released — order abandoned, customer never charged. */
  cancelled: number;
  /** Still waiting on CraftCloud payment, within the TTL. */
  pending: number;
  /** Rows that failed to process this sweep (retried next sweep). */
  errors: number;
}

/**
 * Reconciliation sweep for two-step checkout (CON-118).
 *
 * Under `checkoutModel = "two_step"` our Stripe Checkout only
 * AUTHORIZES the 3% service fee (manual capture — a hold, not a
 * charge). The CraftCloud order is placed up-front unpaid, and the
 * customer pays CraftCloud production + shipping directly via
 * CraftCloud's hosted Stripe session. CraftCloud sends us no webhook,
 * so this sweep polls each in-flight order's CraftCloud status:
 *
 *   - production payment confirmed  → capture our fee, advance the
 *     row to `ordered`, fire the "order placed" notifications (under
 *     two_step this is the moment the order becomes real).
 *   - unconfirmed past the 72h TTL  → cancel the PaymentIntent (the
 *     hold is released; the customer was never charged, so nothing
 *     needs refunding) and mark the row `cancelled`.
 *   - unconfirmed within the TTL    → leave alone, count as pending.
 *
 * Each row is processed in its own try/catch — one bad order (Stripe
 * blip, CraftCloud 500, missing ids) must not stop the rest of the
 * sweep.
 */
export async function reconcileProductionPayments(): Promise<ReconcileResult> {
  const rows = await db
    .select({
      id: printOrders.id,
      craftCloudOrderId: printOrders.craftCloudOrderId,
      feePaymentIntentId: printOrders.feePaymentIntentId,
      feeAuthorizedAt: printOrders.feeAuthorizedAt,
    })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.status, "awaiting_production_payment"),
        eq(printOrders.checkoutModel, "two_step")
      )
    );

  const result: ReconcileResult = {
    captured: 0,
    cancelled: 0,
    pending: 0,
    errors: 0,
  };

  const stripe = getStripe();

  for (const order of rows) {
    try {
      // An awaiting_production_payment row without both ids is a
      // bookkeeping bug — the webhook should have written the PI id
      // and createPrintOrder the CraftCloud order id. Surface it and
      // move on; there is nothing safe to do automatically.
      if (!order.feePaymentIntentId || !order.craftCloudOrderId) {
        logError(
          "reconcileProductionPayments:missingIds",
          new Error(
            `order ${order.id} awaiting production payment but missing ` +
              `${order.feePaymentIntentId ? "" : "feePaymentIntentId "}` +
              `${order.craftCloudOrderId ? "" : "craftCloudOrderId"}`.trim()
          )
        );
        result.errors++;
        continue;
      }

      const intent = await stripe.paymentIntents.retrieve(
        order.feePaymentIntentId
      );

      if (intent.status === "canceled") {
        // Terminal abandonment: the hold is already gone — either
        // Stripe's ~7-day auto-expiry fired or someone cancelled the
        // PI manually. Finalize our side. Conditional on the status
        // still being awaiting_production_payment so we never clobber
        // a row a concurrent worker already advanced.
        await db
          .update(printOrders)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(printOrders.id, order.id),
              eq(printOrders.status, "awaiting_production_payment")
            )
          );
        result.cancelled++;
        continue;
      }

      if (intent.status === "succeeded") {
        // Already captured but our row lagged — a crash between the
        // capture call and the DB update on a previous sweep. Heal.
        await db
          .update(printOrders)
          .set({ status: "ordered", feeCapturedAt: new Date() })
          .where(
            and(
              eq(printOrders.id, order.id),
              eq(printOrders.status, "awaiting_production_payment")
            )
          );
        result.captured++;
        continue;
      }

      if (intent.status !== "requires_capture") {
        // requires_payment_method / processing / etc — the webhook
        // should never have marked this awaiting_production_payment.
        // Leave it for investigation rather than guess.
        logError(
          "reconcileProductionPayments:unexpectedIntentStatus",
          new Error(
            `order ${order.id}: PaymentIntent ${order.feePaymentIntentId} ` +
              `in unexpected status "${intent.status}"`
          )
        );
        result.errors++;
        continue;
      }

      // The normal case: fee is held, waiting on CraftCloud payment.
      const ccStatus = await getOrderStatus(order.craftCloudOrderId);

      if (isProductionPaymentConfirmed(ccStatus)) {
        // Customer paid CraftCloud — charge our fee and make the
        // order real.
        await stripe.paymentIntents.capture(order.feePaymentIntentId);
        const updated = await db
          .update(printOrders)
          .set({ status: "ordered", feeCapturedAt: new Date() })
          .where(
            and(
              eq(printOrders.id, order.id),
              eq(printOrders.status, "awaiting_production_payment")
            )
          )
          .returning({ id: printOrders.id });
        result.captured++;

        // Only notify if OUR update advanced the row — if a
        // concurrent worker won the race it also owns the notify.
        // Notification failures must never look like a failed
        // capture (the money already moved), so swallow them here.
        if (updated.length > 0) {
          try {
            await notifyPrintOrderPlaced(order.id);
          } catch (notifyError) {
            logError("reconcileProductionPayments:notify", notifyError);
          }
        }
        continue;
      }

      const authorizedAt = order.feeAuthorizedAt?.getTime() ?? 0;
      if (Date.now() - authorizedAt > ABANDONMENT_TTL_MS) {
        // Abandoned: the customer never finished CraftCloud's hosted
        // checkout. Cancel the PaymentIntent — this releases the card
        // hold; the customer was NEVER charged, so there is nothing
        // to refund. If this cron misses the cancel (crash, outage),
        // Stripe's ~7-day auto-expiry releases the hold anyway and
        // the next sweep's canceled-PI branch above finalizes the row.
        try {
          await stripe.paymentIntents.cancel(order.feePaymentIntentId);
        } catch (cancelError) {
          // A PI that is already canceled means the hold is already
          // released — exactly the end state we want. Anything else
          // is a real failure.
          if (!isAlreadyCanceledError(cancelError)) throw cancelError;
        }
        await db
          .update(printOrders)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(printOrders.id, order.id),
              eq(printOrders.status, "awaiting_production_payment")
            )
          );
        result.cancelled++;
        continue;
      }

      // Unconfirmed but within the TTL — leave it for a later sweep.
      result.pending++;
    } catch (error) {
      logError("reconcileProductionPayments:order", error);
      result.errors++;
    }
  }

  return result;
}

/**
 * True for the Stripe error thrown when cancelling a PaymentIntent
 * that is already canceled (`payment_intent_unexpected_state`, message
 * like "…has already been canceled"). That state is our goal, so the
 * caller treats it as success.
 */
function isAlreadyCanceledError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: string; message?: string };
  if (err.code === "payment_intent_unexpected_state") return true;
  return /already.*cancel/i.test(err.message ?? "");
}
