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

/**
 * Vendors whose minimum still has to be learned before the cheapest
 * quote per material is certain.
 *
 * A minimum only ever raises a price, so a vendor's total without its
 * minimum is a lower bound. An unprobed vendor can only beat the best
 * known total for a material if that lower bound is below it; once no
 * such vendor is left, the ranking is exact. Probing just the first few
 * per material (what the picker does for its grid) isn't enough when
 * every one of them turns out to have a high minimum: a vendor ranked
 * sixth on item price may be the real cheapest.
 *
 * Returns vendorIds, cheapest lower bound first, excluding any already
 * `attempted` (a failed probe isn't retried within the request).
 */
export function vendorsToProbe(
  quotes: Array<{
    vendorId: string;
    materialId: string;
    priceCents: number;
    shippingPriceCents: number | null;
  }>,
  quantity: number,
  minimums: VendorMinimums,
  attempted: ReadonlySet<string>
): string[] {
  const best = new Map<string, number>();
  for (const q of quotes) {
    if (!minimums.has(q.vendorId)) continue;
    const t = quoteTotals(q, quantity, minimums).totalCents;
    if (t == null) continue;
    const current = best.get(q.materialId);
    if (current == null || t < current) best.set(q.materialId, t);
  }

  const lowerBound = new Map<string, number>();
  for (const q of quotes) {
    if (minimums.has(q.vendorId) || attempted.has(q.vendorId)) continue;
    const bound = quoteTotals(q, quantity, new Map([[q.vendorId, 0]])).totalCents;
    if (bound == null) continue;
    const target = best.get(q.materialId);
    if (target != null && bound >= target) continue;
    const current = lowerBound.get(q.vendorId);
    if (current == null || bound < current) lowerBound.set(q.vendorId, bound);
  }
  return Array.from(lowerBound.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([vendorId]) => vendorId);
}
