import type { Currency } from "./types";

/**
 * Minimal country list for the print-quote region selector. Each
 * entry pairs an ISO-3166-1 alpha-2 country code with the currency
 * we'll request quotes in when the user picks that country.
 * CraftCloud's public API only supports the currencies listed in
 * `lib/craftcloud/types.ts`.
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
  { code: "CA", name: "Canada", currency: "CAD" },
  { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "DE", name: "Germany", currency: "EUR" },
  { code: "FR", name: "France", currency: "EUR" },
  { code: "IT", name: "Italy", currency: "EUR" },
  { code: "ES", name: "Spain", currency: "EUR" },
  { code: "NL", name: "Netherlands", currency: "EUR" },
  { code: "BE", name: "Belgium", currency: "EUR" },
  { code: "AT", name: "Austria", currency: "EUR" },
  { code: "IE", name: "Ireland", currency: "EUR" },
  { code: "PT", name: "Portugal", currency: "EUR" },
  { code: "FI", name: "Finland", currency: "EUR" },
  { code: "CH", name: "Switzerland", currency: "CHF" },
  { code: "NO", name: "Norway", currency: "NOK" },
  { code: "AU", name: "Australia", currency: "AUD" },
  { code: "JP", name: "Japan", currency: "JPY" },
  { code: "IL", name: "Israel", currency: "ILS" },
];

export function findRegion(code: string): Region | undefined {
  return REGIONS.find((r) => r.code === code);
}

export const DEFAULT_REGION: Region = REGIONS[0];
