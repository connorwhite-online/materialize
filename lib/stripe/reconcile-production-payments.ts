import { and, asc, eq } from "drizzle-orm";
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
 *
 * Rows are drained through a bounded worker pool (CONCURRENCY workers,
 * same pattern as app/api/cron/place-auto-approved-orders/route.ts)
 * instead of a strictly serial loop. This is safe because every write
 * below is already conditioned on the row still being in
 * `awaiting_production_payment` — the same idempotency property that
 * lets that cron run concurrent invocations safely applies here across
 * concurrent workers within a single sweep. Each row is claimed by
 * exactly one worker (the shared `idx` counter is only ever advanced
 * synchronously between `await`s), so no row is ever double-processed.
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
    )
    .orderBy(asc(printOrders.feeAuthorizedAt))
    .limit(500);

  const result: ReconcileResult = {
    captured: 0,
    cancelled: 0,
    pending: 0,
    errors: 0,
  };

  const stripe = getStripe();

  async function processOrder(order: (typeof rows)[number]) {
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
        return;
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
        return;
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
        return;
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
        return;
      }

      // The normal case: fee is held, waiting on CraftCloud payment.
      const ccStatus = await getOrderStatus(order.craftCloudOrderId);

      if (isProductionPaymentConfirmed(ccStatus)) {
        // Customer paid CraftCloud — charge our fee and make the
        // order real.
        await captureFeeAndPlaceOrder(order.id, order.feePaymentIntentId);
        result.captured++;
        return;
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
        return;
      }

      // Unconfirmed but within the TTL — leave it for a later sweep.
      result.pending++;
    } catch (error) {
      logError("reconcileProductionPayments:order", error);
      result.errors++;
    }
  }

  // Bounded worker pool: each worker pulls the next unclaimed index off
  // the shared counter. Advancing `idx` happens synchronously (no
  // `await` between read and increment), so two workers can never claim
  // the same row.
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      await processOrder(rows[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker())
  );

  return result;
}

/**
 * Capture the held service fee and advance the order to `ordered` —
 * the moment a two-step order becomes real. Shared by the hourly
 * reconcile sweep (CraftCloud payment confirmed by polling) and the
 * sandbox craftcloud-pay action (mock checkout's stand-in for that
 * confirmation).
 *
 * The status update is conditional on the row still being
 * `awaiting_production_payment`, so concurrent callers can't
 * double-advance; only the caller whose update wins fires the
 * "order placed" notifications. Notification failures are swallowed
 * (logged) — the money already moved, so they must never surface as
 * a failed capture.
 */
export async function captureFeeAndPlaceOrder(
  orderId: string,
  feePaymentIntentId: string
): Promise<void> {
  await getStripe().paymentIntents.capture(feePaymentIntentId);
  const updated = await db
    .update(printOrders)
    .set({ status: "ordered", feeCapturedAt: new Date() })
    .where(
      and(
        eq(printOrders.id, orderId),
        eq(printOrders.status, "awaiting_production_payment")
      )
    )
    .returning({ id: printOrders.id });

  if (updated.length > 0) {
    try {
      await notifyPrintOrderPlaced(orderId);
    } catch (notifyError) {
      logError("captureFeeAndPlaceOrder:notify", notifyError);
    }
  }
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
