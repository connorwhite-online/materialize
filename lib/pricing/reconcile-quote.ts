import "server-only";

import { getPrice, CraftCloudApiError } from "@/lib/craftcloud/client";
import type { PriceResponse, Quote } from "@/lib/craftcloud/types";

/**
 * The one place a client- or agent-supplied quote is turned into the
 * numbers we charge. Every checkout entry point (createPrintOrder,
 * addToCart, repriceCartItem, checkoutVendorGroup and the MCP
 * create_order path) calls this instead of trusting what it was sent.
 *
 * It re-reads the priceId snapshot from CraftCloud and returns, from
 * that snapshot alone:
 *   - the per-unit material price (MTR-130),
 *   - the quote's own vendor, material config and quantity (the quoteId
 *     encodes all three, and it's what CraftCloud builds the cart from,
 *     so a mismatched vendorId would skip the vendor minimum and a
 *     mismatched quantity would bill 1 unit for a 100-unit print),
 *   - the shipping price for the chosen shippingId, which must belong to
 *     the quote's vendor (a client-sent shipping price of 0 used to flow
 *     straight into the charge).
 *
 * Charges are always in USD (every Stripe line item is `usd`), so a
 * quote in any other currency is refused here rather than billed as if
 * its number were dollars.
 */

// Rounding-only tolerance: getPrice() returns dollars as a float, and
// converting to cents can leave a fractional-cent difference between
// what the client displayed and what we re-derive. Anything beyond this
// is a tampered or stale price, never a business discount. Do not widen
// without a documented policy decision (MTR-130).
export const PRICE_RECONCILE_TOLERANCE_CENTS = 1;

export const CHECKOUT_CURRENCY = "USD";

export interface ReconcileMessages {
  expired: string;
  priceChanged: string;
  quantityMismatch?: string;
}

export const DEFAULT_RECONCILE_MESSAGES: ReconcileMessages = {
  expired:
    "This quote has expired. Please pick a material again — prices may have changed.",
  priceChanged:
    "Pricing has changed since you selected this option. Please refresh and try again.",
};

export type ReconciledQuote = {
  ok: true;
  priceCents: number;
  quote: Quote;
  /** Only set when a shippingId was passed. */
  shipping?: { shippingId: string; priceCents: number };
};

export interface ReconcileParams {
  priceId: string;
  quoteId: string;
  claimedPriceCents: number;
  /**
   * When given, the quote's own baked-in quantity must equal it — the
   * quantity we're about to bill (MONEY-1).
   */
  expectedQuantity?: number;
  /** When given, its price is read off the snapshot, not the caller. */
  shippingId?: string;
}

const currencyError = () =>
  `Checkout is in ${CHECKOUT_CURRENCY} only. Please refresh the quote and try again.`;

/**
 * Fetch a priceId snapshot, mapping CraftCloud's "quote expired" to a
 * user-facing error. Exposed so a multi-item checkout can fetch each
 * distinct priceId once and reconcile every line against it.
 */
export async function fetchPriceSnapshot(
  priceId: string,
  messages: ReconcileMessages = DEFAULT_RECONCILE_MESSAGES
): Promise<{ ok: true; snapshot: PriceResponse } | { ok: false; error: string }> {
  try {
    return { ok: true, snapshot: await getPrice(priceId) };
  } catch (error) {
    if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
      return { ok: false, error: messages.expired };
    }
    throw error;
  }
}

export function shippingOptionsOf(snapshot: PriceResponse) {
  return snapshot.shippings ?? snapshot.shipping ?? [];
}

/**
 * Pure half of `reconcileQuote`: checks a quote (and optional shipping
 * choice) against a snapshot already in hand.
 */
export function reconcileQuoteInSnapshot(
  snapshot: PriceResponse,
  params: Omit<ReconcileParams, "priceId">,
  messages: ReconcileMessages = DEFAULT_RECONCILE_MESSAGES
): ReconciledQuote | { ok: false; error: string } {
  const quote = snapshot.quotes?.find((q) => q.quoteId === params.quoteId);
  if (!quote) return { ok: false, error: messages.expired };

  if (quote.currency && quote.currency !== CHECKOUT_CURRENCY) {
    return { ok: false, error: currencyError() };
  }

  if (
    params.expectedQuantity !== undefined &&
    quote.quantity !== params.expectedQuantity
  ) {
    return {
      ok: false,
      error:
        messages.quantityMismatch ??
        "This item's quantity is out of sync with its saved price. Please refresh and try again.",
    };
  }

  const authoritativeCents = Math.round(quote.price * 100);
  if (
    Math.abs(authoritativeCents - params.claimedPriceCents) >
    PRICE_RECONCILE_TOLERANCE_CENTS
  ) {
    return { ok: false, error: messages.priceChanged };
  }

  let shipping: ReconciledQuote["shipping"];
  if (params.shippingId !== undefined) {
    const option = shippingOptionsOf(snapshot).find(
      (s) => s.shippingId === params.shippingId && s.vendorId === quote.vendorId
    );
    if (!option) return { ok: false, error: messages.priceChanged };
    if (option.currency && option.currency !== CHECKOUT_CURRENCY) {
      return { ok: false, error: currencyError() };
    }
    shipping = {
      shippingId: option.shippingId,
      priceCents: Math.round(option.price * 100),
    };
  }

  return { ok: true, priceCents: authoritativeCents, quote, shipping };
}

export async function reconcileQuote(
  params: ReconcileParams,
  messages: ReconcileMessages = DEFAULT_RECONCILE_MESSAGES
): Promise<ReconciledQuote | { ok: false; error: string }> {
  const fetched = await fetchPriceSnapshot(params.priceId, messages);
  if (!fetched.ok) return fetched;
  return reconcileQuoteInSnapshot(fetched.snapshot, params, messages);
}
