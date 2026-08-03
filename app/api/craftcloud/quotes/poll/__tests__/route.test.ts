import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks -----------------------------------------------------------

const mockGetPrice = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
}));

const mockGetCraftCloudCatalog = vi.fn();
const mockGetProviderIndex = vi.fn();
vi.mock("@/lib/craftcloud/catalog", () => ({
  getCraftCloudCatalog: () => mockGetCraftCloudCatalog(),
  getProviderIndex: () => mockGetProviderIndex(),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { GET } from "../route";

function pollRequest(query: string): Request {
  return new Request(`http://localhost/api/craftcloud/quotes/poll${query}`);
}

// A catalog entry shaped the way the route's enrichment code reads it.
function catalogEntry(configId: string) {
  return {
    config: { color: "Red", colorCode: "#f00", name: "PLA Red" },
    material: {
      id: "mat-1",
      name: "PLA",
      materialGroupId: "grp-1",
      featuredImage: "img.png",
      sortIndex: 3,
    },
    finishGroup: { id: "fg-1", name: "Standard", featuredImage: "fg.png" },
    group: { name: "Plastics" },
  };
}

const ONE_QUOTE = {
  quoteId: "q1",
  vendorId: "vendor-1",
  modelId: "m1",
  materialConfigId: "cfg-1",
  printingMethodId: null,
  quantity: 1,
  price: 42,
  priceInclVat: 50,
  currency: "USD",
  productionTimeFast: 3,
  productionTimeSlow: 7,
  scale: 1,
};

describe("GET /api/craftcloud/quotes/poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCraftCloudCatalog.mockResolvedValue({
      configById: new Map([["cfg-1", catalogEntry("cfg-1")]]),
    });
    mockGetProviderIndex.mockResolvedValue(
      new Map([
        [
          "vendor-1",
          {
            name: "Acme 3D",
            production: { default: { code: "DE" } },
            stateCode: "BY",
          },
        ],
      ])
    );
  });

  it("returns the snapshot shape the client expects: allComplete + quotes[] + shipping[]", async () => {
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: false,
      quotes: [ONE_QUOTE],
      shippings: [{ shippingId: "s1", vendorId: "vendor-1", type: "standard" }],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveProperty("allComplete", false);
    expect(Array.isArray(json.quotes)).toBe(true);
    expect(Array.isArray(json.shipping)).toBe(true);

    // Quote is enriched with catalog + provider metadata.
    const q = json.quotes[0];
    expect(q.quoteId).toBe("q1");
    expect(q.materialName).toBe("PLA");
    expect(q.finishGroupName).toBe("Standard");
    expect(q.color).toBe("Red");
    expect(q.vendorName).toBe("Acme 3D");
    expect(q.vendorCountryCode).toBe("DE");
  });

  it("falls back to `shipping` when CraftCloud uses the non-plural key", async () => {
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [ONE_QUOTE],
      shipping: [{ shippingId: "s2", vendorId: "vendor-1", type: "express" }],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    const json = await res.json();
    expect(json.shipping).toHaveLength(1);
    expect(json.shipping[0].shippingId).toBe("s2");
  });

  it("represents the cached-library edge case honestly: allComplete:true with empty quotes", async () => {
    // The polling invariant in AGENTS.md: CraftCloud sometimes flips
    // allComplete:true with an empty quote array on cached library
    // modelIds. The route must surface that faithfully (true + []),
    // NOT fabricate quotes — the client's 4-poll stability check
    // depends on seeing the real (empty) snapshot.
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [],
      shippings: [],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allComplete).toBe(true);
    expect(json.quotes).toEqual([]);
    expect(json.shipping).toEqual([]);
  });

  it("drops quotes whose materialConfigId is not in the cached catalog", async () => {
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [ONE_QUOTE, { ...ONE_QUOTE, quoteId: "q2", materialConfigId: "unknown-cfg" }],
      shippings: [],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    const json = await res.json();
    // Only the in-catalog quote survives enrichment.
    expect(json.quotes).toHaveLength(1);
    expect(json.quotes[0].quoteId).toBe("q1");
  });

  it("escalates via logError when dropped-config ratio exceeds the threshold", async () => {
    // 3 of 4 quotes reference a materialConfigId not in the cached
    // catalog — 75% dropped, well past the 25% threshold.
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [
        ONE_QUOTE,
        { ...ONE_QUOTE, quoteId: "q2", materialConfigId: "unknown-1" },
        { ...ONE_QUOTE, quoteId: "q3", materialConfigId: "unknown-2" },
        { ...ONE_QUOTE, quoteId: "q4", materialConfigId: "unknown-3" },
      ],
      shippings: [],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(200);

    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError.mock.calls[0][0]).toBe("quotes.poll.droppedConfigs");
    const loggedError = mockLogError.mock.calls[0][1] as Error;
    expect(loggedError).toBeInstanceOf(Error);
    expect(loggedError.message).toContain("3/4");
    expect((loggedError.cause as Record<string, unknown>).priceId).toBe(
      "price-1"
    );
  });

  it("does not escalate a low, ordinary drop ratio", async () => {
    // 1 of 5 dropped — 20%, under the 25% threshold.
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [
        ONE_QUOTE,
        { ...ONE_QUOTE, quoteId: "q2" },
        { ...ONE_QUOTE, quoteId: "q3" },
        { ...ONE_QUOTE, quoteId: "q4" },
        { ...ONE_QUOTE, quoteId: "q5", materialConfigId: "unknown-1" },
      ],
      shippings: [],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(200);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does not escalate when rawCount is 0 (nothing to drop yet)", async () => {
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: false,
      quotes: [],
      shippings: [],
    });

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(200);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("rejects a missing priceId with 400 and does not call upstream", async () => {
    const res = await GET(pollRequest(""));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Missing priceId/);
    expect(mockGetPrice).not.toHaveBeenCalled();
  });

  it("rejects an empty priceId param with 400", async () => {
    const res = await GET(pollRequest("?priceId="));
    expect(res.status).toBe(400);
    expect(mockGetPrice).not.toHaveBeenCalled();
  });

  it("upstream error → 500 with a sane message, logged, not thrown", async () => {
    mockGetPrice.mockRejectedValue(new Error("CraftCloud getPrice failed"));

    const res = await GET(pollRequest("?priceId=price-1"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch quote snapshot/);
    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError.mock.calls[0][0]).toBe("api/craftcloud/quotes/poll");
  });
});
