import "server-only";

/**
 * Thin wrapper over CraftCloud's v5 API. Exports the functions we
 * actually use from server actions / routes:
 *
 *   uploadModel                       — initiate/PUT/confirm chain
 *                                       (see model-upload.ts; /v5/model
 *                                       was removed by CraftCloud)
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
import { uploadModelToCraftCloud } from "./model-upload";
import {
  normalizeOrderStatus,
  type RawOrderStatusResponse,
} from "./order-status";

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

/**
 * Status codes we consider safely retryable. 408/429/5xx are transient
 * by definition; 4xx (other than 408/429) are client-side bugs we don't
 * recover from by trying again.
 */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-attempt timeouts for server-side CraftCloud calls. Without one,
 * a hung upstream holds the route (and the user's spinner) until the
 * platform kills the function. GETs are short and retried; mutating
 * calls get longer because they are never retried, so a premature
 * abort is a user-visible failure.
 */
export const GET_TIMEOUT_MS = 10_000;
export const MUTATION_TIMEOUT_MS = 20_000;

export interface ApiRequestOptions {
  /** Caller cancellation (e.g. the incoming request's signal). */
  signal?: AbortSignal;
}

function isTimeoutError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "TimeoutError";
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  // Only auto-retry GETs. POSTs that mutate (createCart, createOrder)
  // are not idempotent on CraftCloud's side — retrying after a
  // network blip could place a duplicate cart/order with no way for
  // us to tell if the prior attempt succeeded. The webhook layer's
  // atomic claim handles end-to-end retries for createOrder.
  const canRetry = method.toUpperCase() === "GET";
  const timeoutMs = canRetry ? GET_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
  const callerSignal = options.signal;

  let lastError: unknown;
  for (let attempt = 0; attempt < (canRetry ? RETRY_ATTEMPTS : 1); attempt++) {
    try {
      // Fresh timeout per attempt, so one slow attempt doesn't eat the
      // retries' budget. The caller's signal still cancels everything.
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, timeout])
        : timeout;
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      if (res.ok) return res.json();

      const text = await res.text();
      const error = new CraftCloudApiError(res.status, text, path);
      if (canRetry && TRANSIENT_STATUSES.has(res.status)) {
        lastError = error;
      } else {
        throw error;
      }
    } catch (err) {
      // The caller gave up — never retry, and let the abort surface
      // as-is so it isn't mistaken for a CraftCloud failure.
      if (callerSignal?.aborted) throw err;

      // fetch() rejects on network errors (DNS, ECONNRESET, etc.) —
      // those are always transient. A timeout surfaces as a 504
      // CraftCloudApiError so callers' existing status handling (and
      // the transient set) treats it like an upstream gateway timeout.
      const normalized = isTimeoutError(err)
        ? new CraftCloudApiError(
            504,
            `Request timed out after ${timeoutMs}ms`,
            path
          )
        : err;
      if (normalized instanceof CraftCloudApiError) {
        if (!canRetry || !TRANSIENT_STATUSES.has(normalized.status)) {
          throw normalized;
        }
        lastError = normalized;
      } else {
        if (!canRetry) throw normalized;
        lastError = normalized;
      }
    }

    // Exponential backoff: 200ms, 800ms, then we exit the loop.
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BASE_MS * Math.pow(4, attempt));
    }
  }

  throw lastError;
}

// --- Real API client ---

async function realUploadModel(
  fileBuffer: Uint8Array,
  filename: string,
  unit: FileUnit = "mm"
): Promise<CraftCloudModel> {
  // Runs the same initiate → S3 PUT → confirm chain as the browser
  // path; see model-upload.ts for why /v5/model no longer exists.
  const model = await uploadModelToCraftCloud(fileBuffer, filename, unit);
  return {
    id: model.modelId,
    filename,
    fileUnit: unit,
    geometry: model.dimensions
      ? {
          dimensions: model.dimensions,
          volume: model.volume ?? 0,
          surfaceArea: model.surfaceArea ?? 0,
          // The confirm response carries no triangle count — the old
          // /v5/model payload did. Nothing branches on it today; it is
          // only persisted into fileAssets.geometryData.
          triangleCount: 0,
        }
      : null,
    status: model.isParsing ? "parsing" : "ready",
  };
}

/**
 * DEAD as of Aug 2026 — `/v5/model/{modelId}` was removed alongside
 * `POST /v5/model` and there is no documented replacement for
 * fetching a model by id. Left in place because it has no production
 * callers (tests only); any live call will 404. If a caller ever
 * needs this again, the `isParsing` flag on the upload confirm
 * response is the nearest equivalent signal.
 */
async function realGetModel(modelId: string): Promise<CraftCloudModel & { parsing: boolean }> {
  const path = `/v5/model/${encodeURIComponent(modelId)}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  });
  const parsing = res.status === 206;
  // SEC-26 — 206 ("still parsing") is itself in the 2xx `res.ok` range,
  // so this only rejects genuine non-2xx responses. Before this check,
  // a 500 (or any other error status) fell straight through to
  // `res.json()` and got returned as if the model were `ready`, so a
  // caller could hand a broken/nonexistent model along to price/cart
  // requests downstream. Matches the CraftCloudApiError usage in
  // apiRequest() above.
  if (!res.ok && !parsing) {
    const text = await res.text();
    throw new CraftCloudApiError(res.status, text, path);
  }
  const model = await res.json();
  return { ...model, parsing, status: parsing ? "parsing" : "ready" };
}

async function realCreatePriceRequest(params: PriceRequest): Promise<{ priceId: string }> {
  return apiRequest("POST", "/v5/price", params);
}

async function realGetPrice(
  priceId: string,
  options?: ApiRequestOptions
): Promise<PriceResponse> {
  return apiRequest(
    "GET",
    `/v5/price/${encodeURIComponent(priceId)}`,
    undefined,
    options
  );
}

async function realCreateCart(params: CartRequest): Promise<Cart> {
  return apiRequest("POST", "/v5/cart", params);
}

async function realCreateOrder(params: OrderRequest): Promise<Order> {
  return apiRequest("POST", "/v5/order", params);
}

async function realGetOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  const raw = await apiRequest<RawOrderStatusResponse>(
    "GET",
    `/v5/order/${encodeURIComponent(orderId)}/status`
  );
  return normalizeOrderStatus(orderId, raw);
}

async function realCreateStripeCheckout(
  params: StripeCheckoutRequest
): Promise<StripeCheckoutResponse> {
  // The wire shape is `{ id, url }` (createStripePaymentResponse in
  // CraftCloud's api-docs.json), not our `{ sessionId, sessionUrl }`.
  // Returning it raw left both fields undefined, and the first live
  // two-step checkout died persisting them ("No values to set").
  const res = await apiRequest<{ id?: string; url?: string }>(
    "POST",
    "/v5/payment/stripe",
    params
  );
  if (!res?.id || !res?.url) {
    throw new Error(
      `CraftCloud /v5/payment/stripe returned no session: ${JSON.stringify(res)}`
    );
  }
  return { sessionId: res.id, sessionUrl: res.url };
}

// --- Mock client (for development without API access) ---

import {
  getMockModel,
  getMockPriceResponse,
  getMockCart,
  getMockOrder,
  getMockOrderStatus,
  selectMockCatalogConfigIds,
} from "./mock";

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
  if (USE_MOCK) {
    // Embed the requested quantity so getMockPriceResponse can model
    // the per-unit volume discount (the mock is otherwise stateless —
    // getPrice only receives the priceId, not the original request).
    const quantity = params.models[0]?.quantity ?? 1;
    return { priceId: `mock-price-q${quantity}-${Date.now()}` };
  }
  return realCreatePriceRequest(params);
}

export async function getPrice(
  priceId: string,
  options?: ApiRequestOptions
): Promise<PriceResponse> {
  if (USE_MOCK) {
    // Prefer real catalog config ids so the poll enricher can attach
    // finish names / images. Fall back to the hardcoded mock roster
    // when the catalog fetch fails (unit tests, offline).
    let configIds: string[] | undefined;
    try {
      const { getCraftCloudCatalog } = await import("./catalog");
      const catalog = await getCraftCloudCatalog();
      const selected = selectMockCatalogConfigIds(catalog);
      if (selected.length > 0) configIds = selected;
    } catch {
      configIds = undefined;
    }
    return getMockPriceResponse(priceId, configIds);
  }
  return realGetPrice(priceId, options);
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
    // Stand-in for CraftCloud's hosted payment page: an in-app sandbox
    // checkout (app/sandbox/craftcloud-pay) that renders the
    // production+shipping bill and, on "Pay", advances the order the
    // same way the reconcile cron would on a confirmed live payment.
    // Without this page the mock bridge URL pointed straight at the
    // returnUrl, so mock two-step checkouts skipped the production
    // payment step entirely and sat in awaiting_production_payment
    // until the hourly cron quietly auto-confirmed them.
    // Only the CraftCloud order id rides along — the page derives its
    // own return/cancel targets from the order row, so no redirect
    // URLs pass through the query string.
    const sandbox = new URL("/sandbox/craftcloud-pay", params.returnUrl);
    sandbox.searchParams.set("ccOrderId", params.orderId);
    return {
      sessionId: `mock-session-${Date.now()}`,
      sessionUrl: sandbox.toString(),
    };
  }
  return realCreateStripeCheckout(params);
}

/**
 * True when checkout-side CraftCloud calls are mocked (CRAFTCLOUD_USE_MOCK
 * unset/true, or CRAFTCLOUD_MOCK_CHECKOUT=true). The sandbox
 * craftcloud-pay page and its pay action gate on this so the mock
 * payment surface can never touch a live order.
 */
export function isMockCheckoutMode(): boolean {
  return USE_MOCK_CHECKOUT;
}
