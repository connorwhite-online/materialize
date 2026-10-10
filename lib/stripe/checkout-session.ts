import "server-only";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";

/**
 * Outcome of closing a print order's Stripe Checkout session before the
 * order row itself is discarded or cancelled.
 *
 *  - `"closed"` — the session is (now) expired; it can never take a
 *    payment, so the order row is safe to drop.
 *  - `"completed"` — the buyer already finished checkout (paid, or an
 *    async/manual-capture payment is pending). The order must NOT be
 *    discarded/cancelled: the webhook is about to (or should) advance it.
 *  - `"unknown"` — Stripe couldn't be reached or answered unexpectedly.
 *    Callers treat this like `"completed"` and leave the row alone;
 *    tomorrow's run / the user's retry gets another go.
 */
export type CloseCheckoutSessionResult = "closed" | "completed" | "unknown";

/**
 * Expire an open Checkout session so a stale tab (or a session minted
 * by resumePrintOrder hours before a sweep) can't complete payment
 * against an order we're about to delete or cancel. Without this, the
 * payment lands on a row the webhook no longer advances, and the buyer
 * is charged for an order nobody places.
 *
 * Retrieve → expire, then re-retrieve if the expire call fails: the
 * buyer may have completed checkout between the two calls, which is
 * exactly the case we must not cancel over.
 *
 * Only call this with a Checkout session id — classify the overloaded
 * `printOrders.stripeSessionId` column first (never a `pi_…` id or a
 * `session_claim:` sentinel).
 */
export async function closeCheckoutSession(
  sessionId: string,
  context: string
): Promise<CloseCheckoutSessionResult> {
  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") return "completed";
    if (session.status === "expired") return "closed";

    try {
      await stripe.checkout.sessions.expire(sessionId);
      return "closed";
    } catch (expireErr) {
      // Lost a race with the buyer (completed) or with another expirer
      // (already expired). Re-read to tell them apart.
      const again = await stripe.checkout.sessions.retrieve(sessionId);
      if (again.status === "complete") return "completed";
      if (again.status === "expired") return "closed";
      throw expireErr;
    }
  } catch (err) {
    logError(`${context}.closeCheckoutSession`, err);
    return "unknown";
  }
}
