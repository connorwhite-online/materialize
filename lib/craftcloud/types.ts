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
  printingMethodId: string;
  quantity: number;
  price: number;
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
  status: "pending" | "ready";
  quotes: Quote[];
  shipping: ShippingOption[];
}

export interface CartRequest {
  shippingIds: string[];
  currency: Currency;
  quotes: Array<{
    quoteId: string;
    vendorId: string;
    modelId: string;
    materialConfigId: string;
    quantity: number;
  }>;
  note?: string;
  customerReference?: string;
}

export interface Cart {
  cartId: string;
  totalPrice: number;
  currency: Currency;
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
