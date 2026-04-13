export type Currency = "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "CHF" | "NOK" | "JPY" | "ILS";
export type FileUnit = "mm" | "cm" | "in";
export type OrderStatus = "ordered" | "in_production" | "shipped" | "received" | "blocked" | "cancelled";

export interface CraftCloudModel {
  id: string;
  filename: string;
  fileUnit: FileUnit;
  geometry: {
    dimensions: { x: number; y: number; z: number };
    volume: number;
    surfaceArea: number;
    triangleCount: number;
  } | null;
  status: "parsing" | "ready" | "error";
}

export interface PriceRequest {
  currency: Currency;
  countryCode: string;
  models: Array<{
    modelId: string;
    quantity: number;
  }>;
  materialConfigIds?: string[];
  vendorIds?: string[];
  topMaterialConfigsOnly?: boolean;
}

export interface Quote {
  quoteId: string;
  vendorId: string;
  modelId: string;
  materialConfigId: string;
  printingMethodId: string | null;
  quantity: number;
  price: number;
  priceInclVat?: number;
  discount?: number;
  currency: Currency;
  productionTimeFast: number;
  productionTimeSlow: number;
  scale: number;
}

export interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  currency: Currency;
  type: "standard" | "express";
  carrier: string;
}

export interface PriceResponse {
  priceId: string;
  /**
   * CraftCloud's progressive price response. `allComplete: false`
   * while vendors are still returning prices — clients are meant to
   * keep polling until it flips to true, though partial results in
   * `quotes` are valid at every step.
   */
  allComplete: boolean;
  expiresAt?: number;
  quotes: Quote[];
  shipping: ShippingOption[];
  shippings?: ShippingOption[];
}

export interface CartRequest {
  shippingIds: string[];
  currency: Currency;
  /**
   * Cart quote entries — `id` is the quoteId from the price
   * response. `types` is an optional list of option upgrades
   * (expedited, infill, tolerance) that were priced into the quote.
   */
  quotes: Array<{
    id: string;
    types?: string[];
    note?: string;
  }>;
  note?: string;
  customerReference?: string;
  voucherCode?: string;
}

export interface Cart {
  cartId: string;
  currency: Currency;
  countryCode?: string;
  expiresAt?: number;
  amounts?: {
    total?: { net?: number; gross?: number };
  };
}

export interface OrderRequest {
  cartId: string;
  user: {
    emailAddress: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  };
}

export interface Address {
  firstName: string;
  lastName: string;
  address: string;
  addressLine2?: string;
  city: string;
  zipCode: string;
  stateCode?: string;
  countryCode: string;
  companyName?: string;
  phoneNumber?: string;
}

export interface Order {
  orderId: string;
  status: OrderStatus;
}

export interface OrderStatusResponse {
  orderId: string;
  vendorStatuses: Array<{
    vendorId: string;
    status: OrderStatus;
    trackingUrl?: string;
    trackingNumber?: string;
  }>;
}

export interface StripeCheckoutRequest {
  orderId: string;
  returnUrl: string;
  cancelUrl: string;
  isTestOrder?: boolean;
}

export interface StripeCheckoutResponse {
  sessionId: string;
  sessionUrl: string;
}
