import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

// Force LIVE mode (not mock) so apiRequest is exercised. Module-level
// USE_MOCK is captured at import time and other test files in the
// same worker may have cached client.ts with USE_MOCK=true — reset
// modules and re-import to get a fresh, live-mode copy.
vi.stubEnv("CRAFTCLOUD_USE_MOCK", "false");
vi.stubEnv("CRAFTCLOUD_MOCK_CHECKOUT", "false");

const fetchMock = vi.fn();
const originalFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

type ClientModule = typeof import("../client");
let getPrice: ClientModule["getPrice"];
let getOrderStatus: ClientModule["getOrderStatus"];
let createOrder: ClientModule["createOrder"];
let CraftCloudApiError: ClientModule["CraftCloudApiError"];

beforeAll(async () => {
  vi.resetModules();
  const mod = await import("../client");
  ({ getPrice, getOrderStatus, createOrder, CraftCloudApiError } = mod);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe("apiRequest retry behavior", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("GET retries on a 502 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse("bad gateway", 502))
      .mockResolvedValueOnce(jsonResponse({ priceId: "p1", quotes: [], shipping: [], allComplete: true }));

    const out = await getPrice("p1");
    expect(out.priceId).toBe("p1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("GET retries up to 3 attempts then throws CraftCloudApiError", async () => {
    // Each attempt needs a fresh Response — Response.text() consumes
    // the body, so a single shared instance can't survive 3 reads.
    fetchMock.mockImplementation(() => textResponse("upstream down", 503));

    await expect(getPrice("p1")).rejects.toBeInstanceOf(CraftCloudApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("GET does NOT retry on a 4xx (client error)", async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse('{"error":"quote not found"}', 404)
    );

    await expect(getOrderStatus("does-not-exist")).rejects.toBeInstanceOf(
      CraftCloudApiError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET retries on network error (fetch rejection)", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ priceId: "p1", quotes: [], shipping: [], allComplete: true }));

    const out = await getPrice("p1");
    expect(out.priceId).toBe("p1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POST (createOrder) does NOT retry — non-idempotent", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("transient blip", 503));

    await expect(
      createOrder({
        cartId: "cart-1",
        user: {
          emailAddress: "a@b.c",
          shipping: {
            firstName: "A",
            lastName: "B",
            address: "1",
            city: "C",
            zipCode: "00000",
            countryCode: "US",
          },
          billing: {
            firstName: "A",
            lastName: "B",
            address: "1",
            city: "C",
            zipCode: "00000",
            countryCode: "US",
            isCompany: false,
          },
        },
      })
    ).rejects.toBeInstanceOf(CraftCloudApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
