import "server-only";

import type {
  CraftCloudModel,
  PriceRequest,
  PriceResponse,
  CartRequest,
  Cart,
  OrderRequest,
  Order,
  OrderStatusResponse,
  StripeCheckoutRequest,
  StripeCheckoutResponse,
  FileUnit,
} from "./types";

const BASE_URL = process.env.CRAFTCLOUD_API_BASE_URL || "https://api.craftcloud3d.com";
const USE_MOCK = process.env.CRAFTCLOUD_USE_MOCK !== "false";

/**
 * Scoped flag for checkout. When true, only the bookable-side
 * endpoints (`createCart`, `createOrder`, `createStripeCheckout`,
 * `getOrderStatus`) short-circuit to the mock implementations.
 * Quote fetching, model upload, and price polling all stay live,
 * so prices and vendors you see in the configurator are real — but
 * clicking "Proceed to checkout" will never actually place a real
 * cart against CraftCloud. Falls back to `USE_MOCK` when the scoped
 * flag isn't set, so the existing "everything mock" mode still works.
 */
const USE_MOCK_CHECKOUT =
  USE_MOCK || process.env.CRAFTCLOUD_MOCK_CHECKOUT === "true";

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Craft Cloud API error ${res.status}: ${text}`);
  }

  return res.json();
}

// --- Real API client ---

async function realUploadModel(
  fileBuffer: Uint8Array,
  filename: string,
  unit: FileUnit = "mm"
): Promise<CraftCloudModel> {
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer.buffer as ArrayBuffer]), filename);
  formData.append("unit", unit);

  const res = await fetch(`${BASE_URL}/v5/model`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  const models = await res.json();
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("CraftCloud returned no models after upload");
  }
  return models[0];
}

async function realGetModel(modelId: string): Promise<CraftCloudModel & { parsing: boolean }> {
  const res = await fetch(`${BASE_URL}/v5/model/${modelId}`);
  const parsing = res.status === 206;
  const model = await res.json();
  return { ...model, parsing, status: parsing ? "parsing" : "ready" };
}

async function realCreatePriceRequest(params: PriceRequest): Promise<{ priceId: string }> {
  return apiRequest("POST", "/v5/price", params);
}

async function realGetPrice(priceId: string): Promise<PriceResponse> {
  return apiRequest("GET", `/v5/price/${priceId}`);
}

async function realCreateCart(params: CartRequest): Promise<Cart> {
  return apiRequest("POST", "/v5/cart", params);
}

async function realCreateOrder(params: OrderRequest): Promise<Order> {
  return apiRequest("POST", "/v5/order", params);
}

async function realGetOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  return apiRequest("GET", `/v5/order/${orderId}/status`);
}

async function realCreateStripeCheckout(
  params: StripeCheckoutRequest
): Promise<StripeCheckoutResponse> {
  return apiRequest("POST", "/v5/payment/stripe", params);
}

// --- Mock client (for development without API access) ---

import { getMockModel, getMockPriceResponse, getMockCart, getMockOrder, getMockOrderStatus } from "./mock";

// --- Exported client ---

export async function uploadModel(
  fileBuffer: Uint8Array,
  filename: string,
  unit: FileUnit = "mm"
): Promise<CraftCloudModel> {
  if (USE_MOCK) return getMockModel(filename, unit);
  return realUploadModel(fileBuffer, filename, unit);
}

export async function getModel(modelId: string): Promise<CraftCloudModel & { parsing: boolean }> {
  if (USE_MOCK) return { ...getMockModel("model.stl", "mm"), id: modelId, parsing: false, status: "ready" };
  return realGetModel(modelId);
}

export async function createPriceRequest(params: PriceRequest): Promise<{ priceId: string }> {
  if (USE_MOCK) return { priceId: `mock-price-${Date.now()}` };
  return realCreatePriceRequest(params);
}

export async function getPrice(priceId: string): Promise<PriceResponse> {
  if (USE_MOCK) return getMockPriceResponse(priceId);
  return realGetPrice(priceId);
}

export async function createCart(params: CartRequest): Promise<Cart> {
  if (USE_MOCK_CHECKOUT) return getMockCart();
  return realCreateCart(params);
}

export async function createOrder(params: OrderRequest): Promise<Order> {
  if (USE_MOCK_CHECKOUT) return getMockOrder();
  return realCreateOrder(params);
}

export async function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  if (USE_MOCK_CHECKOUT) return getMockOrderStatus(orderId);
  return realGetOrderStatus(orderId);
}

export async function createStripeCheckout(
  params: StripeCheckoutRequest
): Promise<StripeCheckoutResponse> {
  if (USE_MOCK_CHECKOUT) {
    return {
      sessionId: `mock-session-${Date.now()}`,
      sessionUrl: params.returnUrl,
    };
  }
  return realCreateStripeCheckout(params);
}
