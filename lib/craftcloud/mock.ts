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

export function getMockPriceResponse(priceId: string): PriceResponse {
  const quotes = MOCK_MATERIALS.flatMap((material) =>
    MOCK_VENDORS.map((vendor) => ({
      quoteId: `quote-${material.id}-${vendor.id}`,
      vendorId: vendor.id,
      modelId: "mock-model",
      materialConfigId: material.id,
      printingMethodId: material.method.toLowerCase(),
      quantity: 1,
      price: material.priceBase * (0.8 + Math.random() * 0.4),
      currency: "USD" as const,
      productionTimeFast: 3,
      productionTimeSlow: 7,
      scale: 1,
    }))
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
