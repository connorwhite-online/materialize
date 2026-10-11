/**
 * What a single-item (fileAssetId-backed), single-checkout print order's
 * Stripe Checkout session charges, in cents.
 *
 * Mirrors the line items built by `createStripeSessionForOrder`
 * (app/actions/print.ts) and the agent-confirm session in
 * app/actions/agent-orders.ts — keep all three in step:
 *
 *   - with a breakdown: material × quantity, plus the implied vendor
 *     minimum production fee when positive, plus shipping when positive;
 *   - without one: `totalPrice` as one line;
 *   - plus the service fee and any license fee (lib/print/license.ts)
 *     either way.
 *
 * The Stripe webhook compares a paid session's `amount_total` against
 * this before placing the CraftCloud order (lib/stripe/
 * handle-print-order-payment.ts). Multi-item and two_step orders are
 * priced differently and are not covered here.
 */
export function expectedSingleItemCheckoutCents(order: {
  totalPrice: number;
  serviceFee: number;
  licenseFee?: number;
  materialSubtotal: number | null;
  shippingSubtotal: number | null;
  quantity: number | null;
}): number {
  const { materialSubtotal, shippingSubtotal, quantity } = order;
  let goods: number;
  if (materialSubtotal != null && shippingSubtotal != null && quantity != null) {
    goods = materialSubtotal * quantity;
    const impliedProductionFee =
      order.totalPrice - (materialSubtotal * quantity + shippingSubtotal);
    if (impliedProductionFee > 0) goods += impliedProductionFee;
    if (shippingSubtotal > 0) goods += shippingSubtotal;
  } else {
    goods = order.totalPrice;
  }
  return goods + order.serviceFee + (order.licenseFee ?? 0);
}
