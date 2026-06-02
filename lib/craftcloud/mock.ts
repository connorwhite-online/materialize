import type {
  CraftCloudModel,
  PriceResponse,
  Cart,
  Order,
  OrderStatusResponse,
  FileUnit,
} from "./types";

export function getMockModel(filename: string, unit: FileUnit): CraftCloudModel {
  return {
    id: `mock-model-${Date.now()}`,
    filename,
    fileUnit: unit,
    geometry: {
      dimensions: { x: 50, y: 30, z: 20 },
      volume: 15000,
      surfaceArea: 7400,
      triangleCount: 12500,
    },
    status: "ready",
  };
}

const MOCK_MATERIALS = [
  { id: "pla-white", name: "PLA White", method: "FDM", priceBase: 8.99 },
  { id: "pla-black", name: "PLA Black", method: "FDM", priceBase: 8.99 },
  { id: "abs-white", name: "ABS White", method: "FDM", priceBase: 12.5 },
  { id: "nylon-pa12", name: "Nylon PA12", method: "SLS", priceBase: 24.99 },
  { id: "nylon-pa12-black", name: "Nylon PA12 Black", method: "SLS", priceBase: 26.99 },
  { id: "resin-standard", name: "Standard Resin", method: "SLA", priceBase: 18.5 },
  { id: "resin-tough", name: "Tough Resin", method: "SLA", priceBase: 22.0 },
  { id: "steel-316l", name: "Stainless Steel 316L", method: "DMLS", priceBase: 89.0 },
  { id: "aluminum", name: "Aluminum AlSi10Mg", method: "DMLS", priceBase: 75.0 },
  { id: "titanium", name: "Titanium Ti6Al4V", method: "DMLS", priceBase: 150.0 },
];

const MOCK_VENDORS = [
  { id: "vendor-1", name: "PrintLab EU" },
  { id: "vendor-2", name: "MakerForge US" },
  { id: "vendor-3", name: "PrecisionParts DE" },
];

/**
 * Deterministic 0..1 hash of a string. Replaces the old
 * `Math.random()` vendor jitter so a given (material, vendor) pair
 * prices the same on every poll — without this, re-polling made the
 * quote grid flicker and made the quantity re-quote impossible to
 * eyeball (the price moved for reasons unrelated to quantity).
 */
function stableUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 to unsigned, then scale to [0, 1).
  return (h >>> 0) / 0xffffffff;
}

/**
 * Per-unit volume discount curve. Real CraftCloud vendor prices drop
 * sharply per unit as quantity rises (fixed setup cost amortizes);
 * the mock previously hardcoded quantity:1 and never reflected this,
 * so the cart's "+1" looked like a flat multiply. Model a gentle
 * decreasing curve: full price at qty 1, asymptotically approaching
 * ~55% per unit by the time you hit double digits.
 */
function volumeUnitFactor(quantity: number): number {
  const q = Math.max(1, quantity);
  // 1.0 at q=1, ~0.86 at q=2, ~0.7 at q=5, ~0.6 at q=10, floored at 0.55.
  return Math.max(0.55, 1 - 0.2 * Math.log(q));
}

/**
 * The client embeds the requested quantity into the mock priceId
 * (see createPriceRequest in client.ts) so getMockPriceResponse can
 * price the volume discount without a stateful store. Falls back to
 * 1 for any priceId that predates / doesn't carry the marker.
 */
function quantityFromPriceId(priceId: string): number {
  const match = /mock-price-q(\d+)-/.exec(priceId);
  const q = match ? Number(match[1]) : 1;
  return Number.isFinite(q) && q >= 1 ? q : 1;
}

export function getMockPriceResponse(priceId: string): PriceResponse {
  const quantity = quantityFromPriceId(priceId);
  const unitFactor = volumeUnitFactor(quantity);
  const quotes = MOCK_MATERIALS.flatMap((material) =>
    MOCK_VENDORS.map((vendor) => {
      // Deterministic per-(material, vendor) variation in [0.8, 1.2],
      // then the quantity volume discount on top — so the per-unit
      // price visibly drops as the user bumps quantity.
      const variation = 0.8 + stableUnit(`${material.id}-${vendor.id}`) * 0.4;
      return {
        quoteId: `quote-${material.id}-${vendor.id}`,
        vendorId: vendor.id,
        modelId: "mock-model",
        materialConfigId: material.id,
        printingMethodId: material.method.toLowerCase(),
        quantity,
        price: material.priceBase * variation * unitFactor,
        currency: "USD" as const,
        productionTimeFast: 3,
        productionTimeSlow: 7,
        scale: 1,
      };
    })
  );

  const shipping = MOCK_VENDORS.flatMap((vendor) => [
    {
      shippingId: `ship-std-${vendor.id}`,
      vendorId: vendor.id,
      name: "Standard Shipping",
      deliveryTime: 7,
      price: 5.99,
      currency: "USD" as const,
      type: "standard" as const,
      carrier: "DHL",
    },
    {
      shippingId: `ship-exp-${vendor.id}`,
      vendorId: vendor.id,
      name: "Express Shipping",
      deliveryTime: 3,
      price: 14.99,
      currency: "USD" as const,
      type: "express" as const,
      carrier: "FedEx",
    },
  ]);

  return {
    priceId,
    allComplete: true,
    quotes,
    shipping,
  };
}

export function getMockCart(): Cart {
  return {
    cartId: `mock-cart-${Date.now()}`,
    currency: "USD",
    countryCode: "US",
  };
}

export function getMockOrder(): Order {
  return {
    orderId: `mock-order-${Date.now()}`,
    status: "ordered",
  };
}

export function getMockOrderStatus(orderId: string): OrderStatusResponse {
  return {
    orderId,
    vendorStatuses: [
      {
        vendorId: "vendor-1",
        status: "in_production",
      },
    ],
  };
}
