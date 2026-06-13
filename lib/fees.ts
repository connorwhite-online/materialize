/**
 * Service fee calculation for Materialize.
 *
 * The platform takes a 3% service fee on the pre-shipping subtotal.
 * Shipping is excluded from the fee base because charging a fee on
 * freight would make our cut scale with unrelated logistics costs.
 *
 * All amounts are in integer cents.
 *
 * ## Two-step checkout minimum
 * Under `checkoutModel = "two_step"` our Stripe session covers ONLY
 * the service fee — there are no other line items to pad the total.
 * Stripe requires a minimum charge of $0.50 (50 cents). We clamp the
 * two-step fee to that minimum so cheap single-part prints don't cause
 * `checkout.sessions.create` to throw.
 *
 * Single-checkout sessions carry the full production + shipping line
 * items alongside the fee, so the session total is always well above
 * $0.50 regardless of the fee amount — no clamp needed there.
 *
 * Flagged for review: the 50-cent minimum is disclosed to the user in
 * price-display.tsx (two_step path). If the real CraftCloud reseller
 * deal lands and CHECKOUT_MODEL reverts to "single", this clamp
 * becomes a no-op via the checkoutModel parameter (CON-116).
 */

export const SERVICE_FEE_RATE = 0.03;

/**
 * Calculate the service fee in cents.
 *
 * @param preShippingCents - Pre-shipping subtotal in integer cents
 * @param checkoutModel - When "two_step", clamps the fee to Stripe's
 *   minimum charge amount (50 cents) so the fee-only session doesn't
 *   throw. Defaults to "single" (no clamp).
 */
export function calcServiceFee(
  preShippingCents: number,
  checkoutModel: "single" | "two_step" = "single"
): number {
  const fee = Math.round(preShippingCents * SERVICE_FEE_RATE);
  if (checkoutModel === "two_step") {
    // Stripe minimum charge is 50 cents. A fee-only session below this
    // throws at session creation time. The clamp is two_step-specific
    // because single-checkout sessions include production + shipping
    // line items and will always exceed the minimum regardless of fee.
    return Math.max(fee, 50);
  }
  return fee;
}
