import type { EnrichedQuote } from "./types";
import {
  effectiveUnitPrice,
  quoteTotal,
  type VendorMinimums,
} from "./vendor-minimums";

export interface ShippingLite {
  vendorId: string;
  price: number;
  /** CraftCloud shipping id — needed to probe a vendor's minimum via a cart. */
  shippingId?: string;
  /**
   * Days in transit. Optional so call sites that only care about
   * price keep compiling; treated as 0 when absent (same default
   * cheapest-shipping uses when a poll snapshot hasn't landed yet).
   */
  deliveryTime?: number;
}

export interface FinishCard {
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  /** Cheapest per-unit production price, vendor minimum included — the "from $X" label. */
  cheapest: number;
  /** Min total (production*qty + minimum fee + shipping) across this finish — sort key. */
  cheapestTotal: number;
  configCount: number;
  colorCount: number;
}

export function cheapestShippingByVendor(
  shipping: ShippingLite[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of shipping) {
    const current = map.get(s.vendorId);
    if (current === undefined || s.price < current) {
      map.set(s.vendorId, s.price);
    }
  }
  return map;
}

/**
 * Collapse a material's quotes into finish-group cards, cheapest-by-total
 * first. Same sort the old finish step used — the leading card is the
 * default preselect when the user hasn't asked for a specific finish.
 */
export function aggregateFinishCards(
  quotes: EnrichedQuote[],
  shipping: ShippingLite[],
  sortQuantity: number,
  materialId: string,
  minimums?: VendorMinimums
): FinishCard[] {
  const shippingByVendor = cheapestShippingByVendor(shipping);
  const totalCost = (q: { price: number; vendorId: string }) =>
    quoteTotal(q, sortQuantity, shippingByVendor, minimums);
  const unitPrice = (q: { price: number; vendorId: string }) =>
    effectiveUnitPrice(q, sortQuantity, minimums);

  const byFinish = new Map<string, FinishCard & { colors: Set<string> }>();
  for (const q of quotes) {
    if (q.materialId !== materialId) continue;
    const total = totalCost(q);
    const existing = byFinish.get(q.finishGroupId);
    if (!existing) {
      byFinish.set(q.finishGroupId, {
        finishGroupId: q.finishGroupId,
        finishGroupName: q.finishGroupName,
        finishGroupImage: q.finishGroupImage,
        cheapest: unitPrice(q),
        cheapestTotal: total,
        configCount: 1,
        colorCount: 0,
        colors: new Set([q.color]),
      });
    } else {
      existing.configCount++;
      existing.colors.add(q.color);
      const unit = unitPrice(q);
      if (unit < existing.cheapest) existing.cheapest = unit;
      if (total < existing.cheapestTotal) existing.cheapestTotal = total;
    }
  }

  return Array.from(byFinish.values())
    .map((c) => ({
      finishGroupId: c.finishGroupId,
      finishGroupName: c.finishGroupName,
      finishGroupImage: c.finishGroupImage,
      cheapest: c.cheapest,
      cheapestTotal: c.cheapestTotal,
      configCount: c.configCount,
      colorCount: c.colors.size,
    }))
    .sort((a, b) => a.cheapestTotal - b.cheapestTotal);
}

/**
 * Prefer an explicit finish (Print-with-X / already-selected quote)
 * when it's still in the set; otherwise the cheapest card.
 */
export function pickDefaultFinishGroupId(
  cards: FinishCard[],
  preferredId?: string | null
): string | null {
  if (cards.length === 0) return null;
  if (preferredId && cards.some((c) => c.finishGroupId === preferredId)) {
    return preferredId;
  }
  return cards[0].finishGroupId;
}
