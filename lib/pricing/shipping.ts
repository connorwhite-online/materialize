/**
 * Shipping-fee deduplication.
 *
 * CraftCloud treats shipping as a per-order charge (one fee per
 * vendor-group regardless of item count). Our `cart_items` table
 * however stores `shippingPrice` on every row as the vendor's fee
 * for whichever shipping option the user picked — so a 2-item
 * same-vendor cart has the same shippingPrice copied twice.
 *
 * A naive sum double-charges the customer. This helper collapses
 * the duplication by keying on `shippingId`: the first occurrence
 * wins, the rest are ignored. For a typical single-vendor cart
 * this boils down to "one shipping fee, period."
 *
 * Used by:
 *   - app/actions/print.ts (checkoutVendorGroup totalPrice calc)
 *   - components/print/cart-panel.tsx (vendor group subtotal)
 *   - components/print/price-display.tsx (ExistingCartSummary)
 */
export function dedupeShippingByShipId(
  items: ReadonlyArray<{ shippingId: string; shippingPrice: number }>
): number {
  if (items.length === 0) return 0;
  const seen = new Map<string, number>();
  for (const item of items) {
    if (!seen.has(item.shippingId)) {
      seen.set(item.shippingId, item.shippingPrice);
    }
  }
  let total = 0;
  for (const price of seen.values()) total += price;
  return total;
}
