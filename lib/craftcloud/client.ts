import "server-only";

/**
 * Thin wrapper over CraftCloud's v5 API. Exports the functions we
 * actually use from server actions / routes:
 *
 *   uploadModel / getModel            — /v5/model
 *   createPriceRequest / getPrice     — /v5/price  (progressive)
 *   createCart                        — /v5/cart
 *   createOrder / getOrderStatus      — /v5/order
 *   createStripeCheckout              — bookable-side Stripe bridge
 *
 * Each function has a real `realX` and a mock `mockX` implementation;
 * USE_MOCK / USE_MOCK_CHECKOUT env flags decide which is called. Mock
 * mode is on by default so running the app without an API key still
 * works against fake data.
 *
 * Quote polling is progressive — getPrice returns allComplete:false
 * while vendor responses are still landing, and the quotes array
 * grows over time. The client-side polling loop in
 * quote-configurator.tsx is responsible for waiting long enough; do
 * not build a long-lived loop inside a server handler here.
 */

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

/**
 * Thrown when CraftCloud's API returns a non-2xx response. Callers
 * can inspect `.status` and `.body` to distinguish user-actionable
 * failures (e.g. "quote expired") from transient server errors.
 */
export class CraftCloudApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly path: string;

  constructor(status: number, body: string, path: string) {
    super(`Craft Cloud API error ${status} at ${path}: ${body}`);
    this.name = "CraftCloudApiError";
    this.status = status;
    this.body = body;
    this.path = path;
  }

  /**
   * True when the error body suggests a quote is no longer valid —
   * typically stale cart items after the quoteId's TTL elapsed.
   * Match the server's wording conservatively; prefer false-negative
   * (show generic error) over false-positive (tell the user their
   * cart expired when actually it's a different bug).
   */
  isQuoteExpired(): boolean {
    if (this.status !== 400 && this.status !== 404) return false;
    const lowered = this.body.toLowerCase();
    return (
      lowered.includes("quote") &&
      (lowered.includes("not found") ||
        lowered.includes("expired") ||
        lowered.includes("invalid"))
    );
  }
}

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
    throw new CraftCloudApiError(res.status, text, path);
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
