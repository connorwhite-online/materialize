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

/**
 * `days` business days after `from` (UTC), skipping Saturday and Sunday.
 * CraftCloud's production and delivery times are business days.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/**
 * When the part should arrive if ordered now: production, then the
 * vendor's shipping time, both in business days. People want the date it
 * reaches them, not how long the printer takes. Null without both times.
 */
export function arrivalWindow(
  q: {
    productionTimeFastDays: number | null;
    productionTimeSlowDays: number | null;
    shippingDaysMin: number | null;
    shippingDaysMax: number | null;
  },
  now: Date = new Date()
): { arrivesEarliest: string; arrivesLatest: string } | null {
  const fast = q.productionTimeFastDays ?? q.productionTimeSlowDays;
  const slow = q.productionTimeSlowDays ?? q.productionTimeFastDays;
  const shipMin = q.shippingDaysMin ?? q.shippingDaysMax;
  const shipMax = q.shippingDaysMax ?? q.shippingDaysMin;
  if (fast == null || slow == null || shipMin == null || shipMax == null) return null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    arrivesEarliest: iso(addBusinessDays(now, fast + shipMin)),
    arrivesLatest: iso(addBusinessDays(now, slow + shipMax)),
  };
}

/**
 * A day count from CraftCloud, which is typed as a number but has arrived
 * as a string range ("2-3"). Adding the string to a number concatenated
 * it ("4" + "2" = 42 days) and the card said "Arrives Dec 8-22" for a part
 * due in a week. Returns [min, max], or null for anything unreadable.
 */
export function parseDays(v: unknown): [number, number] | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return [v, v];
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] != null ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * The printing process of a CraftCloud material: its first printing
 * method's short name, else read off the material name ("SLS Nylon
 * PA12", "HP MJF Nylon PA12", "FDM Nylon").
 */
export function processOf(material: {
  name: string;
  printingMethods?: Array<{ name: string }>;
}): string | null {
  const fromName = material.name.match(/\b(FDM|FFF|SLS|MJF|SLA|DLP|LCD|PolyJet|SLM|DMLS|MJ|BJ)\b/i)?.[1];
  const method = material.printingMethods?.[0]?.name;
  const p = (fromName ?? method ?? "").trim();
  if (!p) return null;
  return /^fff$/i.test(p) ? "FDM" : p.length <= 6 ? p.toUpperCase() : p;
}

/** FDM is the hobbyist process; everything else counts as industrial. */
export function isIndustrial(process: string | null): boolean {
  return process != null && !/^(FDM|FFF)$/i.test(process) && !/fused/i.test(process);
}

export interface Lead {
  /** The option the card and the agent should lead with. */
  quoteId: string;
  why: "industrial" | "cheapest";
  /** The other option worth a tap: a cheaper FDM print, or an upgrade. */
  alternative: { quoteId: string; kind: "cheaper" | "upgrade"; deltaCents: number } | null;
}

/** Lead with industrial unless it costs more than this times the cheapest. */
export const INDUSTRIAL_LEAD_MAX_RATIO = 2;

/**
 * Lead with the cheapest industrial print (SLS, MJF, SLA…) and offer the
 * cheaper FDM print beside it. For a small part the two processes cost
 * about the same to print and the gap is mostly shipping (a 20 mm cube:
 * SLS printing $10.09 vs FDM $10.99, totals $43.91 vs $24.35 because of
 * shipping), so the industrial part is usually the better buy. When it
 * would cost more than INDUSTRIAL_LEAD_MAX_RATIO times the cheapest, lead
 * with the cheapest and offer industrial as the upgrade instead.
 * `quotes` must be sorted by buyer total (byBuyerTotal).
 */
export function chooseLead(
  quotes: Array<{ quoteId: string; process: string | null; totalCents: number | null }>
): Lead | null {
  const priced = quotes.filter((q) => q.totalCents != null);
  if (!priced.length) return null;
  const cheapest = priced[0];
  const industrial = priced.find((q) => isIndustrial(q.process));
  if (!industrial || industrial.quoteId === cheapest.quoteId) {
    return { quoteId: cheapest.quoteId, why: "cheapest", alternative: null };
  }
  const delta = industrial.totalCents! - cheapest.totalCents!;
  if (industrial.totalCents! <= cheapest.totalCents! * INDUSTRIAL_LEAD_MAX_RATIO) {
    return {
      quoteId: industrial.quoteId,
      why: "industrial",
      alternative: { quoteId: cheapest.quoteId, kind: "cheaper", deltaCents: delta },
    };
  }
  return {
    quoteId: cheapest.quoteId,
    why: "cheapest",
    alternative: { quoteId: industrial.quoteId, kind: "upgrade", deltaCents: delta },
  };
}

/** How many options a quote result carries. */
export const MAX_QUOTE_OPTIONS = 12;

/**
 * Keep the cheapest config per material + vendor, best first, capped,
 * always keeping the lead. CraftCloud returns every colour and finish
 * from every vendor (hundreds of rows for one cube); the agent and the
 * card need the choices, not the colour swatches, and a payload that
 * size invites the model to re-tabulate it under the card.
 * `quotes` must be sorted by buyer total.
 */
export function trimQuotes<
  T extends { quoteId: string; materialId: string; vendorId: string },
>(quotes: T[], keepQuoteIds: string[] = [], max = MAX_QUOTE_OPTIONS): T[] {
  // Every material's cheapest option first, so asking for five nylons
  // returns five nylons even when one material has a dozen vendors; then
  // other vendors per material, best first, up to the cap.
  const keep = new Set(keepQuoteIds);
  const chosen = new Set<string>();
  const seen = new Set<string>();
  const materials = new Set<string>();
  for (const q of quotes) {
    if (materials.has(q.materialId) && !keep.has(q.quoteId)) continue;
    materials.add(q.materialId);
    seen.add(`${q.materialId}|${q.vendorId}`);
    chosen.add(q.quoteId);
  }
  for (const q of quotes) {
    if (chosen.size >= max) break;
    const k = `${q.materialId}|${q.vendorId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    chosen.add(q.quoteId);
  }
  return quotes.filter((q) => chosen.has(q.quoteId));
}
