import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreatePriceRequest = vi.fn();
const mockGetPrice = vi.fn();
vi.mock("@/lib/craftcloud/client", () => {
  class CraftCloudApiError extends Error {
    constructor(public expired: boolean) {
      super("CraftCloud error");
    }
    isQuoteExpired() {
      return this.expired;
    }
  }
  return {
    createPriceRequest: (...args: unknown[]) => mockCreatePriceRequest(...args),
    getPrice: (...args: unknown[]) => mockGetPrice(...args),
    CraftCloudApiError,
  };
});

const mockGetCraftCloudCatalog = vi.fn();
const mockGetProviderIndex = vi.fn();
vi.mock("@/lib/craftcloud/catalog", () => ({
  getCraftCloudCatalog: () => mockGetCraftCloudCatalog(),
  getProviderIndex: () => mockGetProviderIndex(),
}));

import { CraftCloudApiError } from "@/lib/craftcloud/client";
import { getQuoteProvider } from "@/lib/quotes";
import { craftCloudQuoteProvider } from "../craftcloud-provider";
import { QuoteModelNotReadyError, QuoteModelRejectedError } from "../types";

const ApiError = CraftCloudApiError as unknown as new (
  expired: boolean
) => Error;

const BASE = { currency: "USD" as const, countryCode: "US", quantity: 1 };

const CATALOG = {
  materialById: new Map([
    ["mat-1", { finishGroups: [{ materialConfigs: [{ id: "cfg-1" }] }] }],
  ]),
  configById: new Map([
    [
      "cfg-1",
      {
        config: { color: "Red", colorCode: "#f00", name: "PLA Red" },
        material: {
          id: "mat-1",
          name: "PLA",
          materialGroupId: "grp-1",
          featuredImage: null,
          sortIndex: undefined,
        },
        finishGroup: { id: "fg-1", name: "Standard", featuredImage: null },
        group: { name: "Plastics" },
      },
    ],
  ]),
};

function rawQuote(materialConfigId: string) {
  return {
    quoteId: `q-${materialConfigId}`,
    vendorId: "vendor-1",
    modelId: "m1",
    materialConfigId,
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 3,
    productionTimeSlow: 7,
    scale: 1,
  };
}

describe("craftCloudQuoteProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePriceRequest.mockResolvedValue({ priceId: "price-1" });
    mockGetCraftCloudCatalog.mockResolvedValue(CATALOG);
    mockGetProviderIndex.mockResolvedValue(
      new Map([["vendor-1", { name: "Acme", production: { default: { code: "US" } }, stateCode: "OR" }]])
    );
  });

  it("is the provider getQuoteProvider() serves", () => {
    expect(getQuoteProvider()).toBe(craftCloudQuoteProvider);
  });

  it("quotes a stored asset by its CraftCloud model id", async () => {
    const res = await craftCloudQuoteProvider.startQuote({
      ...BASE,
      model: { kind: "asset", asset: { id: "a1", craftCloudModelId: "cc-1" } },
    });
    expect(res).toEqual({ priceId: "price-1" });
    expect(mockCreatePriceRequest.mock.calls[0][0].models).toEqual([
      { modelId: "cc-1", quantity: 1 },
    ]);
  });

  it("throws QuoteModelNotReadyError for an asset not yet registered", async () => {
    await expect(
      craftCloudQuoteProvider.startQuote({
        ...BASE,
        model: { kind: "asset", asset: { id: "a1", craftCloudModelId: null } },
      })
    ).rejects.toBeInstanceOf(QuoteModelNotReadyError);
    expect(mockCreatePriceRequest).not.toHaveBeenCalled();
  });

  it("ignores an unknown material scope instead of failing", async () => {
    await craftCloudQuoteProvider.startQuote({
      ...BASE,
      model: { kind: "providerModel", modelId: "cc-1" },
      materialId: "nope",
    });
    expect(mockCreatePriceRequest.mock.calls[0][0].materialConfigIds).toBeUndefined();
  });

  it("maps an expired-model API error to QuoteModelRejectedError, keeping the cause", async () => {
    const upstream = new ApiError(true);
    mockCreatePriceRequest.mockRejectedValue(upstream);
    const err = await craftCloudQuoteProvider
      .startQuote({ ...BASE, model: { kind: "providerModel", modelId: "cc-1" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuoteModelRejectedError);
    expect((err as Error).cause).toBe(upstream);
  });

  it("passes other upstream errors through untouched", async () => {
    const upstream = new ApiError(false);
    mockCreatePriceRequest.mockRejectedValue(upstream);
    await expect(
      craftCloudQuoteProvider.startQuote({
        ...BASE,
        model: { kind: "providerModel", modelId: "cc-1" },
      })
    ).rejects.toBe(upstream);
  });

  it("enriches quotes, counts drops, and falls back from shippings to shipping", async () => {
    const ship = { shippingId: "s1", vendorId: "vendor-1", name: "UPS", deliveryTime: 3, price: 5, type: "standard" };
    mockGetPrice.mockResolvedValue({
      priceId: "price-1",
      allComplete: true,
      quotes: [rawQuote("cfg-1"), rawQuote("cfg-unknown")],
      shipping: [ship],
    });

    const { snapshot, stats } = await craftCloudQuoteProvider.getSnapshot("price-1");

    expect(stats).toEqual({ rawCount: 2, droppedCount: 1 });
    expect(snapshot.allComplete).toBe(true);
    expect(snapshot.shipping).toEqual([ship]);
    expect(snapshot.quotes).toHaveLength(1);
    expect(snapshot.quotes[0]).toMatchObject({
      quoteId: "q-cfg-1",
      materialName: "PLA",
      materialSortIndex: 9999,
      vendorName: "Acme",
      vendorCountryCode: "US",
      vendorStateCode: "OR",
    });
  });

  it("hasMaterial reads the catalog", async () => {
    expect(await craftCloudQuoteProvider.hasMaterial("mat-1")).toBe(true);
    expect(await craftCloudQuoteProvider.hasMaterial("mat-x")).toBe(false);
  });
});
