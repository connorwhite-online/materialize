import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrderStatusResponse } from "@/lib/craftcloud/types";

// vi.hoisted runs before vi.mock factories (and before module imports),
// so the class is available both in the mock factory AND in test bodies.
const { MockCraftCloudApiError } = vi.hoisted(() => {
  class MockCraftCloudApiError extends Error {
    status: number;
    body: string;
    path: string;
    constructor(status: number, body: string, path: string) {
      super(`Craft Cloud API error ${status} at ${path}: ${body}`);
      this.name = "CraftCloudApiError";
      this.status = status;
      this.body = body;
      this.path = path;
    }
    isQuoteExpired() {
      if (this.status !== 400 && this.status !== 404) return false;
      const l = this.body.toLowerCase();
      return (
        l.includes("quote") &&
        (l.includes("not found") ||
          l.includes("expired") ||
          l.includes("invalid"))
      );
    }
  }
  return { MockCraftCloudApiError };
});

// Mock CraftCloud client. Mocks accept rest args so the indirection
// in vi.mock's factory (`(...args) => mockX(...args)`) type-checks.
const mockCreateCart = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ cartId: "cart-123", totalPrice: 29.99, currency: "USD" })
);
const mockGetOrderStatus = vi.fn(
  (..._args: unknown[]): Promise<OrderStatusResponse> =>
    Promise.resolve({
      orderId: "order-123",
      vendorStatuses: [
        {
          vendorId: "v1",
          status: "shipped",
          trackingUrl: "https://track.me/123",
        },
      ],
    })
);

vi.mock("@/lib/craftcloud/client", () => ({
  createCart: (...args: unknown[]) => mockCreateCart(...args),
  createOrder: vi.fn(),
  getOrderStatus: (...args: unknown[]) => mockGetOrderStatus(...args),
  createStripeCheckout: vi.fn(),
  CraftCloudApiError: MockCraftCloudApiError,
}));

// Mock DB
const mockDbInsertReturning = vi.fn(() => [
  { id: "order-id-1", userId: "test-user-id" },
]);
const mockDbInsertValues = vi.fn();
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (...args: unknown[]) => {
        mockDbInsertValues(...args);
        return {
          returning: () => mockDbInsertReturning(),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => [
          {
            id: "order-id-1",
            userId: "test-user-id",
            craftCloudOrderId: "cc-order-123",
            status: "ordered",
          },
        ],
      }),
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        mockDbUpdateSet(...args);
        return {
          where: (...args: unknown[]) => {
            mockDbUpdateWhere(...args);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: { id: "id", userId: "user_id" },
  fileAssets: { id: "id" },
}));

// The print-ownership gate (CON-73) is unit-tested separately; default
// to "allowed" so the order-mechanics tests stay focused.
vi.mock("@/lib/entitlement", () => ({
  userCanPrintAsset: vi.fn(async () => true),
}));

import { createPrintOrder, checkOrderStatus, checkCartPricing } from "../print";
import { userCanPrintAsset } from "@/lib/entitlement";

describe("createPrintOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userCanPrintAsset).mockResolvedValue(true);
  });

  it("rejects ordering an asset the user can't print (CON-73)", async () => {
    vi.mocked(userCanPrintAsset).mockResolvedValueOnce(false);
    const result = await createPrintOrder({
      fileAssetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      quoteId: "quote-1",
      vendorId: "vendor-1",
      materialConfigId: "pla-white",
      shippingId: "ship-1",
      quantity: 1,
      materialPrice: 10,
      shippingPrice: 5,
      currency: "USD",
    });
    expect(result).toMatchObject({ error: "File not found" });
    expect(mockCreateCart).not.toHaveBeenCalled();
  });

  it("creates a cart and inserts order record", async () => {
    const result = await createPrintOrder({
      fileAssetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      quoteId: "quote-1",
      vendorId: "vendor-1",
      materialConfigId: "pla-white",
      shippingId: "ship-1",
      quantity: 2,
      materialPrice: 10,
      shippingPrice: 5.99,
      currency: "USD",
    });

    expect(mockCreateCart).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingIds: ["ship-1"],
        currency: "USD",
      })
    );
    expect(result).toHaveProperty("orderId");
    expect(result).toHaveProperty("cartId", "cart-123");
  });

  it("calculates correct total and service fee (CON-163)", async () => {
    // materialPrice=10, quantity=1 → materialSubtotal=1000 cents
    // shippingPrice=5 → shippingSubtotal=500 cents
    // preShippingTotal = 1000 * 1 + 0 (no productionFee) = 1000 cents
    // totalPrice = 1000 + 500 = 1500 cents
    // serviceFee = Math.round(1000 * 0.03) = 30 cents
    await createPrintOrder({
      fileAssetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      quoteId: "quote-1",
      vendorId: "vendor-1",
      materialConfigId: "pla-white",
      shippingId: "ship-1",
      quantity: 1,
      materialPrice: 10,
      shippingPrice: 5,
      currency: "USD",
    });

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        totalPrice: 1500,
        serviceFee: 30,
        materialSubtotal: 1000,
        shippingSubtotal: 500,
      })
    );
  });

  it("CON-138: CraftCloudApiError (non-expired) returns safe generic message, not raw error.message", async () => {
    mockCreateCart.mockRejectedValueOnce(
      new MockCraftCloudApiError(500, "internal /v5/path details leaked here", "/v5/carts")
    );

    const result = await createPrintOrder({
      fileAssetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      quoteId: "quote-1",
      vendorId: "vendor-1",
      materialConfigId: "pla-white",
      shippingId: "ship-1",
      quantity: 1,
      materialPrice: 10,
      shippingPrice: 5,
      currency: "USD",
    });

    if (!("error" in result)) throw new Error("expected error");
    // Must not contain the internal path or raw body
    expect(result.error).not.toContain("/v5/");
    expect(result.error).not.toContain("internal /v5/path details");
    expect(result.error).toMatch(/print partner|try again/i);
  });

  it("CON-138: CraftCloudApiError (quote expired) returns actionable message", async () => {
    mockCreateCart.mockRejectedValueOnce(
      new MockCraftCloudApiError(400, "Quote not found or expired", "/v5/carts")
    );

    const result = await createPrintOrder({
      fileAssetId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      quoteId: "quote-1",
      vendorId: "vendor-1",
      materialConfigId: "pla-white",
      shippingId: "ship-1",
      quantity: 1,
      materialPrice: 10,
      shippingPrice: 5,
      currency: "USD",
    });

    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/expired|pick a material/i);
    expect(result.error).not.toContain("/v5/");
  });
});

describe("checkOrderStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches status from CraftCloud and updates DB", async () => {
    const result = await checkOrderStatus("order-id-1");
    expect(mockGetOrderStatus).toHaveBeenCalledWith("cc-order-123");
    expect(result).toEqual({ status: "shipped" });
  });

  it("updates tracking info when available", async () => {
    await checkOrderStatus("order-id-1");
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "shipped",
        trackingInfo: expect.objectContaining({
          trackingUrl: "https://track.me/123",
        }),
      })
    );
  });

  it("maps blocked status to blocked (not cancelled)", async () => {
    mockGetOrderStatus.mockResolvedValueOnce({
      orderId: "order-123",
      vendorStatuses: [{ vendorId: "v1", status: "blocked" }],
    });
    const result = await checkOrderStatus("order-id-1");
    expect(result).toEqual({ status: "blocked" });
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked" })
    );
  });
});

describe("checkCartPricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a cart with the quote + shipping and returns zero fees when no minimum applies", async () => {
    mockCreateCart.mockResolvedValueOnce({
      cartId: "cart-probe-1",
      currency: "USD",
    } as never);

    const result = await checkCartPricing({
      quoteId: "quote-1",
      vendorId: "vendor-1",
      shippingId: "ship-1",
      currency: "USD",
    });

    expect(mockCreateCart).toHaveBeenCalledWith({
      shippingIds: ["ship-1"],
      currency: "USD",
      quotes: [{ id: "quote-1" }],
    });
    expect(result).toEqual({
      minimumProductionFee: 0,
      vendorMinimumPrice: 0,
    });
  });

  it("surfaces productionFee + vendor minimum when CraftCloud reports one", async () => {
    mockCreateCart.mockResolvedValueOnce({
      cartId: "cart-probe-2",
      currency: "USD",
      minimumProductionPrice: {
        "vendor-1": { price: 130, productionFee: 128.28 },
      },
    } as never);

    const result = await checkCartPricing({
      quoteId: "quote-1",
      vendorId: "vendor-1",
      shippingId: "ship-1",
      currency: "USD",
    });

    expect(result).toEqual({
      minimumProductionFee: 128.28,
      vendorMinimumPrice: 130,
    });
  });

  it("ignores minimums for other vendors in the response", async () => {
    mockCreateCart.mockResolvedValueOnce({
      cartId: "cart-probe-3",
      currency: "USD",
      minimumProductionPrice: {
        "vendor-OTHER": { price: 200, productionFee: 199 },
      },
    } as never);

    const result = await checkCartPricing({
      quoteId: "quote-1",
      vendorId: "vendor-1",
      shippingId: "ship-1",
      currency: "USD",
    });

    // vendor-1 isn't in the minimums map, so no fee.
    expect(result).toEqual({
      minimumProductionFee: 0,
      vendorMinimumPrice: 0,
    });
  });

  it("returns an error object when createCart throws", async () => {
    mockCreateCart.mockRejectedValueOnce(new Error("CraftCloud 500"));

    const result = await checkCartPricing({
      quoteId: "quote-1",
      vendorId: "vendor-1",
      shippingId: "ship-1",
      currency: "USD",
    });

    expect(result).toEqual({ error: "Failed to check cart pricing" });
  });
});
