import "server-only";
import { createCart } from "./client";
import type { Currency } from "./types";
import { logError } from "@/lib/logger";

/**
 * Vendor minimum order values, learned from disposable CraftCloud carts.
 *
 * CraftCloud only reports a vendor's minimum production value on a cart
 * (`minimumProductionPrice[vendorId].price`), never on a quote. It is a
 * property of the vendor — the same for every material and quote it
 * prices — so one cart per vendor is enough, and the answer is cached
 * per server instance. Creating a cart places nothing and reserves
 * nothing we need to release.
 *
 * Consumed by the print picker so vendors are ranked, and priced, by
 * what the buyer will actually pay (components/print/material-picker/
 * vendor-minimums.ts).
 */

export interface MinimumProbe {
  vendorId: string;
  quoteId: string;
  shippingId: string;
}

/** Minimums move rarely; a few hours keeps probes off the hot path. */
const TTL_MS = 6 * 60 * 60 * 1000;
/** Bounds the cart fan-out of one request. */
export const MAX_PROBES_PER_REQUEST = 40;
const CONCURRENCY = 6;

const cache = new Map<string, { minimum: number; fetchedAt: number }>();

function cacheKey(currency: Currency, vendorId: string) {
  return `${currency}:${vendorId}`;
}

/**
 * Returns vendorId → minimum production value (0 = no minimum) for every
 * probe that resolved. Vendors whose cart failed are left out, so the
 * caller can ask again later instead of caching a wrong "no minimum".
 */
export async function getVendorMinimums(
  probes: MinimumProbe[],
  currency: Currency,
  now = Date.now()
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const pending: MinimumProbe[] = [];
  const seen = new Set<string>();

  for (const probe of probes) {
    if (seen.has(probe.vendorId)) continue;
    seen.add(probe.vendorId);
    const hit = cache.get(cacheKey(currency, probe.vendorId));
    if (hit && now - hit.fetchedAt < TTL_MS) {
      out[probe.vendorId] = hit.minimum;
    } else if (pending.length < MAX_PROBES_PER_REQUEST) {
      pending.push(probe);
    }
  }

  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const probe = pending[next++];
      try {
        const cart = await createCart({
          shippingIds: [probe.shippingId],
          currency,
          quotes: [{ id: probe.quoteId }],
        });
        const minimum = cart.minimumProductionPrice?.[probe.vendorId]?.price ?? 0;
        cache.set(cacheKey(currency, probe.vendorId), {
          minimum,
          fetchedAt: now,
        });
        out[probe.vendorId] = minimum;
      } catch (err) {
        // Stale quote id or a CraftCloud hiccup — skip; the picker
        // treats an unknown vendor as having no minimum until asked again.
        // Logged because an agent quote then says the cheapest vendor's
        // minimum is "unconfirmed" (Forge Friend, 2026-10-09) and nothing
        // recorded why.
        logError("vendorMinimums.probeFailed", {
          vendorId: probe.vendorId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
  );
  return out;
}

/** Test hook. */
export function clearVendorMinimumCache() {
  cache.clear();
}
