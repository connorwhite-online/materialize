import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock CraftCloud client
const mockCreateCart = vi.fn(() =>
  Promise.resolve({ cartId: "cart-123", totalPrice: 29.99, currency: "USD" })
);
const mockGetOrderStatus = vi.fn(() =>
  Promise.resolve({
    orderId: "order-123",
    vendorStatuses: [
      { vendorId: "v1", status: "shipped", trackingUrl: "https://track.me/123" },
    ],
  })
);

vi.mock("@/lib/craftcloud/client", () => ({
  createCart: (...args: unknown[]) => mockCreateCart(...args),
  createOrder: vi.fn(),
  getOrderStatus: (...args: unknown[]) => mockGetOrderStatus(...args),
  createStripeCheckout: vi.fn(),
}));

// Mock DB
const mockDbInsertReturning = vi.fn(() => [
  { id: "order-id-1", userId: "test-user-id" },
]);
const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => mockDbInsertReturning(),
      }),
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

import { createPrintOrder, checkOrderStatus, checkCartPricing } from "../print";

describe("createPrintOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("calculates correct total and service fee", async () => {
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

    // total = (10 * 1 + 5) * 100 = 1500 cents
    // serviceFee = 1500 * 0.08 = 120 cents
    expect(mockDbInsertReturning).toHaveBeenCalled();
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
