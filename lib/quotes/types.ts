/**
 * Provider-neutral quote types.
 *
 * Everything the browser sees about a print quote is defined here, not
 * in a provider module. A provider (CraftCloud today, see
 * `craftcloud-provider.ts`) turns its own wire format into these shapes
 * on the server, so the picker, cart and poll loop never learn which
 * service produced a price. Adding a provider means implementing
 * `QuoteProvider`; nothing under `components/print` should change.
 *
 * Client-safe: types only, no server imports.
 */

import type { QuotesRequest } from "@/lib/validations/print";

/** Currencies a quote can be requested in (the request schema's enum). */
export type QuoteCurrency = QuotesRequest["currency"];

/**
 * One priced option: a material config from one vendor at one
 * quantity. The id fields (`vendorId`, `materialConfigId`,
 * `materialId`, …) are opaque to the client — they are whatever the
 * producing provider uses, and only that provider can interpret them
 * at checkout.
 */
export interface EnrichedQuote {
  quoteId: string;
  vendorId: string;
  vendorName: string;
  /**
   * ISO-3166-1 alpha-2 country code of the vendor's primary
   * production location (CraftCloud's `production.default.code`).
   * Null when not published — the vendor card then hides the
   * country / state line entirely.
   */
  vendorCountryCode: string | null;
  /**
   * Subnational code paired with `vendorCountryCode` — usually a
   * US state when the country is `US`, but CraftCloud also
   * populates it for CA provinces, MX states, etc. ISO 3166-2
   * style without the country prefix. Null when CraftCloud
   * doesn't publish one (common for non-US, non-CA, non-MX
   * vendors).
   */
  vendorStateCode: string | null;
  modelId: string;
  materialConfigId: string;
  printingMethodId?: string | null;
  quantity: number;
  price: number;
  priceInclVat?: number;
  currency: string;
  productionTimeFast: number;
  productionTimeSlow: number;
  scale: number;

  // Catalog-enriched
  materialId: string;
  materialName: string;
  materialGroupId: string;
  materialGroupName: string;
  materialImage: string | null;
  /**
   * CraftCloud's curated popularity ordering — lower = more popular
   * (PLA = 1, SLS Nylon PA12 = 0, 316L Steel = 4). We use it to drive
   * the "Popular materials" section at the top of the picker and to
   * order cards within each group's section. Defaults to a large
   * sentinel when the catalog row is missing it so unknowns sink to
   * the bottom rather than tying with rank-0.
   */
  materialSortIndex: number;
  finishGroupId: string;
  finishGroupName: string;
  finishGroupImage: string | null;
  color: string;
  colorCode: string;
  configName: string;
}

/** A shipping method a vendor offers for the quoted model. */
export interface QuoteShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

/**
 * The complete quote set *so far* for one quote request. Each poll
 * returns a full snapshot — callers replace their state with it, never
 * merge. `allComplete` is the provider's own "done" claim; the client
 * poll loop (`components/print/poll-quotes.ts`) deliberately does not
 * trust it alone.
 */
export interface QuoteSnapshot {
  quotes: EnrichedQuote[];
  shipping: QuoteShippingOption[];
  allComplete: boolean;
}

/** Where the model to quote comes from. */
export type QuoteModelSource =
  /**
   * A stored file version the caller is allowed to quote. Carries the
   * provider-side model ids the asset row already holds; the provider
   * picks the one it needs.
   */
  | { kind: "asset"; asset: { id: string; craftCloudModelId: string | null } }
  /** A model the client already registered with the provider (anon draft path). */
  | { kind: "providerModel"; modelId: string };

export interface StartQuoteParams {
  model: QuoteModelSource;
  currency: QuoteCurrency;
  countryCode: string;
  quantity: number;
  /**
   * Optional material scope (the provider's own material id). Narrows
   * which vendors are asked, so a "Print with X" entry paints faster.
   * An id the provider doesn't recognise is ignored, not an error.
   */
  materialId?: string;
}

/** Per-snapshot counters for server-side telemetry; never sent to the client. */
export interface QuoteSnapshotStats {
  /** Quotes the provider returned before enrichment. */
  rawCount: number;
  /** Quotes dropped because they couldn't be enriched (stale catalog). */
  droppedCount: number;
}

export interface QuoteProvider {
  /**
   * Start an asynchronous quote request and return its handle at once.
   * Prices arrive progressively through `getSnapshot`.
   *
   * Throws `QuoteModelNotReadyError` when the stored asset hasn't been
   * registered with this provider yet, and `QuoteModelRejectedError`
   * when the provider refuses the model it was given.
   */
  startQuote(params: StartQuoteParams): Promise<{ priceId: string }>;

  /** Current enriched snapshot for a handle returned by `startQuote`. */
  getSnapshot(
    priceId: string
  ): Promise<{ snapshot: QuoteSnapshot; stats: QuoteSnapshotStats }>;

  /** Whether `materialId` is a material this provider can quote. */
  hasMaterial(materialId: string): Promise<boolean>;
}

/**
 * The stored asset has no model registered with the provider yet (the
 * background upload is still running). Callers surface "try again in a
 * moment" rather than a failure.
 */
export class QuoteModelNotReadyError extends Error {
  constructor() {
    super("Model not yet registered with the quote provider");
    this.name = "QuoteModelNotReadyError";
  }
}

/**
 * The provider refused to price the model (for CraftCloud: a stale or
 * expired model id). Re-registering the model is the fix, so callers
 * that can say so should; `cause` carries the provider's own error.
 */
export class QuoteModelRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Quote provider rejected the model", options);
    this.name = "QuoteModelRejectedError";
  }
}
