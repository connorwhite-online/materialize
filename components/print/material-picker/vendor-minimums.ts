import type { ShippingLite } from "./finish-cards";

/**
 * Vendor minimum order values, folded into every price the picker ranks
 * or shows.
 *
 * Many CraftCloud vendors have a minimum production value per order
 * (Panashape $33, TAY3D $29.61, some $180+). Below it, CraftCloud adds a
 * "production fee" that tops the order up to the minimum. The fee never
 * appears in quote data, only on a cart, so the picker used to rank on
 * item price + shipping alone: a $7.27 part at a $33-minimum vendor
 * showed as the cheapest option and only became $33 after the buyer had
 * picked it.
 *
 * The minimum is a property of the vendor, not the material or quote
 * (verified against live carts: one vendor reports the same minimum for
 * every material config, and `productionFee = max(0, minimum - production)`),
 * so one disposable cart per vendor is enough to learn it.
 *
 * `VendorMinimums` maps vendorId → minimum production value. A vendor
 * that has not been probed yet is simply absent and treated as having
 * no minimum; the picker re-ranks when its probe lands.
 */
export type VendorMinimums = ReadonlyMap<string, number>;

// Type-only: erased at build, so the server-only module never reaches
// the client bundle.
import type { MinimumProbe } from "@/lib/craftcloud/vendor-minimums";
export type { MinimumProbe };

interface PricedQuote {
  quoteId: string;
  vendorId: string;
  materialId: string;
  price: number;
}

/** Production fee CraftCloud will add to reach the vendor's minimum. */
export function minimumFee(
  q: { vendorId: string; price: number },
  quantity: number,
  minimums: VendorMinimums | undefined
): number {
  const minimum = minimums?.get(q.vendorId) ?? 0;
  return Math.max(0, minimum - q.price * quantity);
}

/**
 * Per-unit price the buyer actually pays for production, minimum
 * included — the "from $X" label on material, finish and color pickers.
 */
export function effectiveUnitPrice(
  q: { vendorId: string; price: number },
  quantity: number,
  minimums: VendorMinimums | undefined
): number {
  const qty = Math.max(1, quantity);
  return q.price + minimumFee(q, qty, minimums) / qty;
}

/** Production × qty + minimum fee + the vendor's cheapest shipping. */
export function quoteTotal(
  q: { vendorId: string; price: number },
  quantity: number,
  shippingByVendor: ReadonlyMap<string, number>,
  minimums: VendorMinimums | undefined
): number {
  return (
    q.price * quantity +
    minimumFee(q, quantity, minimums) +
    (shippingByVendor.get(q.vendorId) ?? 0)
  );
}

/** Cheapest shipping option per vendor, keeping its id (a cart needs it). */
function cheapestShippingOptions(
  shipping: ShippingLite[]
): Map<string, { price: number; shippingId: string }> {
  const map = new Map<string, { price: number; shippingId: string }>();
  for (const s of shipping) {
    if (!s.shippingId) continue;
    const current = map.get(s.vendorId);
    if (!current || s.price < current.price) {
      map.set(s.vendorId, { price: s.price, shippingId: s.shippingId });
    }
  }
  return map;
}

/**
 * Which vendors to probe for the material grid: the `perMaterial`
 * cheapest vendors (by item + shipping, before minimums) for each
 * material. Those are the only ones that can hold a card's "from"
 * price, so probing them is enough to keep the grid honest without a
 * cart per vendor in the whole quote set. Vendors with no shipping
 * option yet are skipped — a cart needs one.
 */
export function pickMinimumProbes(
  quotes: PricedQuote[],
  shipping: ShippingLite[],
  quantity: number,
  perMaterial = 5
): MinimumProbe[] {
  const cheapestShip = cheapestShippingOptions(shipping);

  // Cheapest base total per (material, vendor).
  const byMaterial = new Map<string, Map<string, { total: number; quoteId: string }>>();
  for (const q of quotes) {
    const ship = cheapestShip.get(q.vendorId);
    if (!ship) continue;
    const total = q.price * quantity + ship.price;
    const vendors = byMaterial.get(q.materialId) ?? new Map();
    const current = vendors.get(q.vendorId);
    if (!current || total < current.total) {
      vendors.set(q.vendorId, { total, quoteId: q.quoteId });
    }
    byMaterial.set(q.materialId, vendors);
  }

  const probes = new Map<string, MinimumProbe>();
  for (const vendors of byMaterial.values()) {
    const top = Array.from(vendors.entries())
      .sort((a, b) => a[1].total - b[1].total)
      .slice(0, perMaterial);
    for (const [vendorId, { quoteId }] of top) {
      if (probes.has(vendorId)) continue;
      probes.set(vendorId, {
        vendorId,
        quoteId,
        shippingId: cheapestShip.get(vendorId)!.shippingId,
      });
    }
  }
  return Array.from(probes.values());
}

/** Probes for an explicit quote list (the vendor step's visible cards). */
export function probesForQuotes(
  quotes: Array<{ quoteId: string; vendorId: string }>,
  shipping: ShippingLite[]
): MinimumProbe[] {
  const cheapestShip = cheapestShippingOptions(shipping);
  const probes = new Map<string, MinimumProbe>();
  for (const q of quotes) {
    const ship = cheapestShip.get(q.vendorId);
    if (!ship || probes.has(q.vendorId)) continue;
    probes.set(q.vendorId, {
      vendorId: q.vendorId,
      quoteId: q.quoteId,
      shippingId: ship.shippingId,
    });
  }
  return Array.from(probes.values());
}
