/**
 * Service fee calculation for Materialize.
 *
 * The platform takes a 3% service fee on the pre-shipping subtotal.
 * Shipping is excluded from the fee base because charging a fee on
 * freight would make our cut scale with unrelated logistics costs.
 *
 * All amounts are in integer cents.
 *
 * ## Two-step fee floor and cap (Aug 2026 pricing decision)
 * Under `checkoutModel = "two_step"` our Stripe session covers ONLY
 * the service fee, so the fee's economics stand alone:
 *
 *  - FLOOR ($0.99): Stripe takes 2.9% + $0.30 per charge, so an
 *    unclamped 3% fee nets negative on small orders (a 30¢ fee costs
 *    31¢ to collect). 99¢ nets ~66¢ and stays invisible next to any
 *    physical print's price. It also satisfies Stripe's hard 50¢
 *    minimum charge, which is why the floor must NEVER go below 50.
 *  - CAP ($5.00): two_step is the rare model where the customer sees
 *    our fee as its own separate charge, so a large percentage fee on
 *    a big cart invites scrutiny a bundled fee never gets. The cap
 *    binds above a $167 pre-shipping subtotal.
 *
 * These are CONSTANTS, not env vars, on purpose: this function runs in
 * client components (price-display, cart-panel, cart-slot-stack) to
 * render the fee AND in server actions to charge it. A server-only env
 * override would silently diverge the displayed fee from the charged
 * fee. Tuning the numbers is a one-line PR; a display/charge mismatch
 * is a customer-facing bug.
 *
 * The clamp is two_step-ONLY. Single-model print orders and digital
 * listing purchases (app/actions/checkout.ts — where the fee comes out
 * of the CREATOR's payout) keep the pure 3%: applying a 99¢ floor to a
 * $5 file sale would quietly turn 3% into 20% at the creator's
 * expense, which is not the decision that was made.
 */

export const SERVICE_FEE_RATE = 0.03;

/**
 * Two-step fee floor, cents. Must stay >= 50: Stripe rejects charges
 * below $0.50, and the fee is the only line item on a two_step session.
 */
export const TWO_STEP_FEE_MIN_CENTS = 99;

/** Two-step fee cap, cents. Binds above a ~$167 pre-shipping subtotal. */
export const TWO_STEP_FEE_MAX_CENTS = 500;

/**
 * Calculate the service fee in cents.
 *
 * @param preShippingCents - Pre-shipping subtotal in integer cents
 * @param checkoutModel - When "two_step", the fee is clamped to
 *   [TWO_STEP_FEE_MIN_CENTS, TWO_STEP_FEE_MAX_CENTS] — see the header
 *   for why. Defaults to "single" (pure 3%, no clamp).
 */
export function calcServiceFee(
  preShippingCents: number,
  checkoutModel: "single" | "two_step" = "single"
): number {
  const fee = Math.round(preShippingCents * SERVICE_FEE_RATE);
  if (checkoutModel === "two_step") {
    return Math.min(
      Math.max(fee, TWO_STEP_FEE_MIN_CENTS),
      TWO_STEP_FEE_MAX_CENTS
    );
  }
  return fee;
}
