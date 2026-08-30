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

/**
 * Slim catalog slice used to seed mock quotes with real CraftCloud
 * materialConfigIds. Without this, /api/craftcloud/quotes/poll drops
 * every mock quote (the hardcoded pla-white ids are not in the
 * catalog) and the picker never leaves the empty state.
 */
export interface MockCatalogMaterial {
  sortIndex?: number;
  finishGroups?: Array<{
    materialConfigs?: Array<{ id: string; color: string }>;
  }>;
}

const MOCK_CATALOG_MATERIALS = 12;
const MOCK_CATALOG_FINISHES = 8;
const MOCK_CATALOG_COLORS_PER_FINISH = 4;

export function selectMockCatalogConfigIds(
  catalog: { materialById: Map<string, MockCatalogMaterial> }
): string[] {
  const materials = Array.from(catalog.materialById.values())
    .sort((a, b) => (a.sortIndex ?? 9999) - (b.sortIndex ?? 9999))
    .slice(0, MOCK_CATALOG_MATERIALS);

  const ids: string[] = [];
  for (const material of materials) {
    for (const fg of (material.finishGroups ?? []).slice(
      0,
      MOCK_CATALOG_FINISHES
    )) {
      const seen = new Set<string>();
      for (const config of fg.materialConfigs ?? []) {
        if (seen.has(config.color)) continue;
        seen.add(config.color);
        ids.push(config.id);
        if (seen.size >= MOCK_CATALOG_COLORS_PER_FINISH) break;
      }
    }
  }
  return ids;
}

function quotesForConfigIds(
  configIds: string[],
  quantity: number,
  unitFactor: number
) {
  return configIds.flatMap((configId) =>
    MOCK_VENDORS.map((vendor) => {
      const variation = 0.8 + stableUnit(`${configId}-${vendor.id}`) * 0.4;
      const base = 8 + stableUnit(configId) * 42;
      return {
        quoteId: `quote-${configId}-${vendor.id}`,
        vendorId: vendor.id,
        modelId: "mock-model",
        materialConfigId: configId,
        printingMethodId: "fdm",
        quantity,
        price: base * variation * unitFactor,
        currency: "USD" as const,
        productionTimeFast: 3,
        productionTimeSlow: 7,
        scale: 1,
      };
    })
  );
}

export function getMockPriceResponse(
  priceId: string,
  configIds?: string[]
): PriceResponse {
  const quantity = quantityFromPriceId(priceId);
  const unitFactor = volumeUnitFactor(quantity);
  const quotes =
    configIds && configIds.length > 0
      ? quotesForConfigIds(configIds, quantity, unitFactor)
      : MOCK_MATERIALS.flatMap((material) =>
          MOCK_VENDORS.map((vendor) => {
            // Deterministic per-(material, vendor) variation in [0.8, 1.2],
            // then the quantity volume discount on top — so the per-unit
            // price visibly drops as the user bumps quantity.
            const variation =
              0.8 + stableUnit(`${material.id}-${vendor.id}`) * 0.4;
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
  // Empty vendor statuses = "payment not yet confirmed" under
  // isProductionPaymentConfirmed's documented assumption (vendors
  // only report once payment cleared). This must stay unpaid-looking:
  // in mock checkout mode the sandbox craftcloud-pay page advances
  // paid orders synchronously, so the reconcile cron only ever sees
  // ABANDONED mock orders — which should age out through the 72h
  // cancel path, not silently auto-confirm the way the old
  // always-"in_production" response made them.
  return {
    orderId,
    vendorStatuses: [],
  };
}
