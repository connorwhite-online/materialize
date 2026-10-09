import { calcServiceFee } from "@/lib/fees";
import {
  minimumFee,
  type VendorMinimums,
} from "@/components/print/material-picker/vendor-minimums";

/**
 * What the buyer actually pays for an agent quote, the same way the
 * print picker and `createAgentInitiatedOrder` compute it: production ×
 * quantity, plus CraftCloud's top-up to the vendor's minimum order, plus
 * shipping, plus our service fee on the pre-shipping subtotal.
 *
 * Before this, materialize_get_quote returned the raw CraftCloud item
 * price and an agent quoted it as the price. In ChatGPT a $3.54 hex plate
 * showed as "$10.99 delivered", while the order it led to added our 3%
 * and, at a vendor with a minimum, could cost several times that.
 */
export interface QuoteTotals {
  /** CraftCloud's top-up to the vendor minimum; 0 when there is none. */
  minimumFeeCents: number;
  /** False when the vendor's minimum wasn't probed: the total may be low. */
  minimumKnown: boolean;
  serviceFeeCents: number;
  /** Production + minimum top-up + shipping + service fee. */
  totalCents: number | null;
}

export function quoteTotals(
  q: { vendorId: string; priceCents: number; shippingPriceCents: number | null },
  quantity: number,
  minimums: VendorMinimums
): QuoteTotals {
  const qty = Math.max(1, quantity);
  const minimumFeeCents = Math.round(
    minimumFee({ vendorId: q.vendorId, price: q.priceCents / 100 }, qty, minimums) *
      100
  );
  const preShipping = q.priceCents * qty + minimumFeeCents;
  const serviceFeeCents = calcServiceFee(preShipping);
  return {
    minimumFeeCents,
    minimumKnown: minimums.has(q.vendorId),
    serviceFeeCents,
    totalCents:
      q.shippingPriceCents == null
        ? null
        : preShipping + q.shippingPriceCents + serviceFeeCents,
  };
}

/** Cheapest buyer total first; quotes with no shipping price go last. */
export function byBuyerTotal(
  a: { totalCents: number | null; priceCents: number },
  b: { totalCents: number | null; priceCents: number }
): number {
  if (a.totalCents == null || b.totalCents == null) {
    if (a.totalCents == null && b.totalCents == null) {
      return a.priceCents - b.priceCents;
    }
    return a.totalCents == null ? 1 : -1;
  }
  return a.totalCents - b.totalCents;
}
