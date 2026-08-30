import type { ShippingLite } from "./finish-cards";
import { cheapestShippingByVendor } from "./finish-cards";

export interface VendorBadgeQuote {
  quoteId: string;
  vendorId: string;
  price: number;
  productionTimeFast: number;
}

export interface VendorBadges {
  cheapest: boolean;
  fastest: boolean;
}

/**
 * Fastest transit days per vendor across its shipping options.
 * Missing vendors / missing deliveryTime → treated as 0, matching
 * how cheapest-shipping defaults when a poll snapshot hasn't landed
 * a price yet.
 */
export function fastestDeliveryByVendor(
  shipping: ShippingLite[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of shipping) {
    const days = s.deliveryTime ?? 0;
    const current = map.get(s.vendorId);
    if (current === undefined || days < current) {
      map.set(s.vendorId, days);
    }
  }
  return map;
}

/**
 * Which quotes in the *visible* vendor list win Cheapest / Fastest.
 *
 * Cheapest = min(production × qty + cheapest shipping).
 * Fastest  = min(productionTimeFast + fastest shipping delivery).
 *
 * Returns an empty map when there's nothing to compare (0–1 quotes)
 * so a lone vendor doesn't wear both chips for free.
 */
export function vendorQuoteBadges(
  quotes: VendorBadgeQuote[],
  shipping: ShippingLite[],
  sortQuantity: number
): Map<string, VendorBadges> {
  const out = new Map<string, VendorBadges>();
  if (quotes.length < 2) return out;

  const shipPrice = cheapestShippingByVendor(shipping);
  const shipDays = fastestDeliveryByVendor(shipping);

  const totalCost = (q: VendorBadgeQuote) =>
    q.price * sortQuantity + (shipPrice.get(q.vendorId) ?? 0);
  const totalDays = (q: VendorBadgeQuote) =>
    q.productionTimeFast + (shipDays.get(q.vendorId) ?? 0);

  let minCost = Infinity;
  let minDays = Infinity;
  for (const q of quotes) {
    const cost = totalCost(q);
    const days = totalDays(q);
    if (cost < minCost) minCost = cost;
    if (days < minDays) minDays = days;
  }

  for (const q of quotes) {
    out.set(q.quoteId, {
      cheapest: totalCost(q) === minCost,
      fastest: totalDays(q) === minDays,
    });
  }
  return out;
}
