import { describe, it, expect, vi, beforeEach } from "vitest";
import { setMockUserId } from "@/vitest.setup";

// --- Mocks -----------------------------------------------------------

// CraftCloud price-request client. Each test sets its own behaviour.
const mockCreatePriceRequest = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createPriceRequest: (...args: unknown[]) => mockCreatePriceRequest(...args),
}));

// Catalog lookup — only exercised when a materialId scope hint is sent.
const mockGetCraftCloudCatalog = vi.fn();
vi.mock("@/lib/craftcloud/catalog", () => ({
  getCraftCloudCatalog: () => mockGetCraftCloudCatalog(),
}));

// Logger — assert the upstream-error path logs and doesn't rethrow.
const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

// DB — the anon `modelId` path never touches it, but the module
// imports `db`, so provide a benign stub. The `fileAssetId` path is
// not under test here (it's covered by the action/IDOR suites).
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "../route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/craftcloud/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/craftcloud/quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockUserId("test-user-id");
    mockCreatePriceRequest.mockResolvedValue({ priceId: "price-123" });
  });

  it("happy path: valid anon modelId body → starts CraftCloud price req → returns priceId", async () => {
    const res = await POST(
      postRequest({
        modelId: "cc-model-abc",
        currency: "USD",
        countryCode: "US",
        quantity: 2,
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ priceId: "price-123" });

    expect(mockCreatePriceRequest).toHaveBeenCalledOnce();
    const arg = mockCreatePriceRequest.mock.calls[0][0];
    expect(arg.currency).toBe("USD");
    expect(arg.countryCode).toBe("US");
    expect(arg.models).toEqual([{ modelId: "cc-model-abc", quantity: 2 }]);
    // No materialId scope hint → no config narrowing, catalog untouched.
    expect(arg.materialConfigIds).toBeUndefined();
    expect(mockGetCraftCloudCatalog).not.toHaveBeenCalled();
  });

  it("applies schema defaults when optional fields are omitted", async () => {
    // currency/countryCode/quantity all have defaults in the schema.
    const res = await POST(postRequest({ modelId: "cc-model-xyz" }));

    expect(res.status).toBe(200);
    const arg = mockCreatePriceRequest.mock.calls[0][0];
    expect(arg.currency).toBe("USD");
    expect(arg.countryCode).toBe("US");
    expect(arg.models).toEqual([{ modelId: "cc-model-xyz", quantity: 1 }]);
  });

  it("expands a materialId scope hint into materialConfigIds", async () => {
    mockGetCraftCloudCatalog.mockResolvedValue({
      materialById: new Map([
        [
          "mat-1",
          {
            finishGroups: [
              { materialConfigs: [{ id: "cfg-a" }, { id: "cfg-b" }] },
              { materialConfigs: [{ id: "cfg-c" }] },
            ],
          },
        ],
      ]),
    });

    const res = await POST(
      postRequest({ modelId: "cc-model-abc", materialId: "mat-1" })
    );

    expect(res.status).toBe(200);
    expect(mockGetCraftCloudCatalog).toHaveBeenCalledOnce();
    const arg = mockCreatePriceRequest.mock.calls[0][0];
    expect(arg.materialConfigIds).toEqual(["cfg-a", "cfg-b", "cfg-c"]);
  });

  it("rejects a malformed body (neither fileAssetId nor modelId) with 400", async () => {
    const res = await POST(postRequest({ currency: "USD" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
    expect(mockCreatePriceRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty modelId with 400 (schema min(1))", async () => {
    const res = await POST(postRequest({ modelId: "" }));
    expect(res.status).toBe(400);
    expect(mockCreatePriceRequest).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range quantity with 400", async () => {
    const res = await POST(
      postRequest({ modelId: "cc-model-abc", quantity: 9999 })
    );
    expect(res.status).toBe(400);
    expect(mockCreatePriceRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid currency with 400", async () => {
    const res = await POST(
      postRequest({ modelId: "cc-model-abc", currency: "ZZZ" })
    );
    expect(res.status).toBe(400);
  });

  it("upstream CraftCloud error → 500 with a sane message, logged, not thrown", async () => {
    mockCreatePriceRequest.mockRejectedValue(
      new Error("CraftCloud 503 Service Unavailable")
    );

    // Must not reject — the route catches and returns a Response.
    const res = await POST(postRequest({ modelId: "cc-model-abc" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to start quote request/);
    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError.mock.calls[0][0]).toBe("api/craftcloud/quotes");
  });
});
