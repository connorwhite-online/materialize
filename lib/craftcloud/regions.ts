import type { Currency } from "./types";

/**
 * Minimal country list for the print-quote region selector. Each
 * entry pairs an ISO-3166-1 alpha-2 country code with the currency
 * we'll request quotes in when the user picks that country.
 *
 * Every region quotes in USD: checkout charges Stripe in USD, so
 * showing a GBP or JPY price and then billing that number as dollars
 * was wrong for every non-US buyer (£10 charged as $10, ¥1500 as
 * $1,500). The country still drives shipping. Charging in local
 * currency would need per-currency Stripe line items (and zero-decimal
 * handling for JPY) end to end, not just a different quote.
 *
 * Ordering matches what a user would scan for first — US on top,
 * then the major EU buyers, then other CraftCloud-friendly regions.
 */

export interface Region {
  code: string;
  name: string;
  currency: Currency;
}

export const REGIONS: Region[] = [
  { code: "US", name: "United States", currency: "USD" },
  { code: "CA", name: "Canada", currency: "USD" },
  { code: "GB", name: "United Kingdom", currency: "USD" },
  { code: "DE", name: "Germany", currency: "USD" },
  { code: "FR", name: "France", currency: "USD" },
  { code: "IT", name: "Italy", currency: "USD" },
  { code: "ES", name: "Spain", currency: "USD" },
  { code: "NL", name: "Netherlands", currency: "USD" },
  { code: "BE", name: "Belgium", currency: "USD" },
  { code: "AT", name: "Austria", currency: "USD" },
  { code: "IE", name: "Ireland", currency: "USD" },
  { code: "PT", name: "Portugal", currency: "USD" },
  { code: "FI", name: "Finland", currency: "USD" },
  { code: "CH", name: "Switzerland", currency: "USD" },
  { code: "NO", name: "Norway", currency: "USD" },
  { code: "AU", name: "Australia", currency: "USD" },
  { code: "JP", name: "Japan", currency: "USD" },
  { code: "IL", name: "Israel", currency: "USD" },
];

export function findRegion(code: string): Region | undefined {
  return REGIONS.find((r) => r.code === code);
}

export const DEFAULT_REGION: Region = REGIONS[0];
