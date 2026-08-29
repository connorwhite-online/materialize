/**
 * Shared shipping-option shape + helpers for the vendor quote sheet
 * and the quote configurator. Kept free of React so unit tests can
 * pin cheapest-pick without mounting the sheet.
 */

export interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

/**
 * Cheapest shipping option for a vendor. Ties break in favor of the
 * earlier entry (stable). Returns null when the vendor has no
 * shipping in this quote snapshot yet.
 */
export function cheapestShippingForVendor(
  shipping: ShippingOption[],
  vendorId: string
): ShippingOption | null {
  let best: ShippingOption | null = null;
  for (const option of shipping) {
    if (option.vendorId !== vendorId) continue;
    if (!best || option.price < best.price) best = option;
  }
  return best;
}

/** Shipping options for one vendor, cheapest first. */
export function shippingOptionsForVendor(
  shipping: ShippingOption[],
  vendorId: string
): ShippingOption[] {
  return shipping
    .filter((s) => s.vendorId === vendorId)
    .slice()
    .sort((a, b) => a.price - b.price);
}
