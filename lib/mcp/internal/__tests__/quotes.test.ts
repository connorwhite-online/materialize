import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const assetRows: unknown[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => assetRows }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ fileAssets: {}, files: {} }));

const createPriceRequest = vi.fn();
const getPrice = vi.fn();
vi.mock("@/lib/craftcloud/client", () => ({
  createPriceRequest: (...a: unknown[]) => createPriceRequest(...a),
  getPrice: (...a: unknown[]) => getPrice(...a),
  CraftCloudApiError: class extends Error {},
}));
vi.mock("@/lib/craftcloud/catalog", () => ({
  getCraftCloudCatalog: async () => ({
    configById: new Map(),
    materialById: new Map(),
    excludedConfigIds: new Set(),
  }),
  getProviderIndex: async () => new Map(),
}));
vi.mock("@/lib/craftcloud/vendor-minimums", () => ({
  getVendorMinimums: async () => ({}),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
const ensureGeometry = vi.fn();
vi.mock("../geometry", () => ({
  ensureGeometry: (...a: unknown[]) => ensureGeometry(...a),
}));

import { getQuoteForUser } from "../quotes";

const asset = {
  id: "asset-1",
  craftCloudModelId: "model-1",
  originalFilename: "part.stl",
  format: "stl",
};

function row(over: Record<string, unknown>) {
  return {
    asset,
    ownerId: "owner",
    fileStatus: "published",
    fileVisibility: "public",
    fileName: "Part",
    ...over,
  };
}

beforeEach(() => {
  assetRows.length = 0;
  createPriceRequest.mockReset();
  getPrice.mockReset();
  ensureGeometry.mockReset();
  ensureGeometry.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getQuoteForUser", () => {
  it("refuses a non-owner quoting a published listing its owner set private", async () => {
    assetRows.push(row({ fileVisibility: "private" }));
    const out = await getQuoteForUser({
      userId: "someone-else",
      fileAssetId: "asset-1",
    } as never);
    expect(out).toEqual({ error: "Forbidden" });
    expect(createPriceRequest).not.toHaveBeenCalled();
  });

  it("lets the owner quote their own private file", async () => {
    assetRows.push(row({ fileVisibility: "private" }));
    createPriceRequest.mockResolvedValue({ priceId: "p1" });
    getPrice.mockResolvedValue({ quotes: [], shippings: [], allComplete: true });
    vi.useFakeTimers();
    const pending = getQuoteForUser({
      userId: "owner",
      fileAssetId: "asset-1",
    } as never);
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await pending;
    expect(out).not.toHaveProperty("error");
  });

  it("bounds each read by the deadline and keeps what it has when one times out", async () => {
    assetRows.push(row({}));
    createPriceRequest.mockResolvedValue({ priceId: "p1" });
    // First read answers (still incomplete); the second is cut off by
    // its deadline signal. (AbortSignal.timeout runs on real timers, so
    // the timeout itself is simulated.)
    getPrice
      .mockResolvedValueOnce({ quotes: [], shippings: [], allComplete: false })
      .mockRejectedValueOnce(
        Object.assign(new Error("timed out"), { name: "TimeoutError" })
      );
    vi.useFakeTimers();
    const pending = getQuoteForUser({
      userId: "owner",
      fileAssetId: "asset-1",
    } as never);
    await vi.advanceTimersByTimeAsync(5_000);
    const out = await pending;
    expect(out).not.toHaveProperty("error");
    expect(getPrice).toHaveBeenCalledTimes(2);
    for (const call of getPrice.mock.calls) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("still fails when the very first read times out", async () => {
    assetRows.push(row({}));
    createPriceRequest.mockResolvedValue({ priceId: "p1" });
    getPrice.mockRejectedValueOnce(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );
    await expect(
      getQuoteForUser({ userId: "owner", fileAssetId: "asset-1" } as never)
    ).rejects.toThrow("timed out");
  });

  it("starts geometry alongside the quote rather than after it", async () => {
    assetRows.push(row({}));
    createPriceRequest.mockReturnValue(new Promise(() => {}));
    void getQuoteForUser({ userId: "owner", fileAssetId: "asset-1" } as never);
    await vi.waitFor(() => expect(createPriceRequest).toHaveBeenCalled());
    expect(ensureGeometry).toHaveBeenCalledWith(asset);
  });
});
