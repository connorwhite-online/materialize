import type { EnrichedQuote } from "./types";

export interface ShippingLite {
  vendorId: string;
  price: number;
}

export interface FinishCard {
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  /** Cheapest single-unit production price — the "from $X" label. */
  cheapest: number;
  /** Min total (production*qty + shipping) across this finish — sort key. */
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
  materialId: string
): FinishCard[] {
  const shippingByVendor = cheapestShippingByVendor(shipping);
  const totalCost = (q: { price: number; vendorId: string }) =>
    q.price * sortQuantity + (shippingByVendor.get(q.vendorId) ?? 0);

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
        cheapest: q.price,
        cheapestTotal: total,
        configCount: 1,
        colorCount: 0,
        colors: new Set([q.color]),
      });
    } else {
      existing.configCount++;
      existing.colors.add(q.color);
      if (q.price < existing.cheapest) existing.cheapest = q.price;
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
