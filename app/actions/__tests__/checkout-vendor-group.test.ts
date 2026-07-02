import { describe, it, expect, vi, beforeEach } from "vitest";

// checkoutVendorGroup (app/actions/print.ts:296-736) is the multi-vendor
// checkout money path — the common multi-item case — and had zero test
// coverage (MTR-153). Mock pattern mirrors print.test.ts /
// print-two-step.test.ts: mock @/lib/db, @/lib/craftcloud/client, Clerk
// auth (pre-mocked globally in vitest.setup.ts), and @/lib/logger.

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

// Rows db.select(cartItems).where() returns — set per test.
let cartItemsRows: Array<Record<string, unknown>> = [];

const mockCreateCart = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ cartId: "cart-vg-1", currency: "USD" } as {
    cartId: string;
    currency: string;
    minimumProductionPrice?: Record<
      string,
      { price: number; productionFee: number }
    >;
  })
);

vi.mock("@/lib/craftcloud/client", () => ({
  createCart: (...args: unknown[]) => mockCreateCart(...args),
  createOrder: vi.fn(),
  createStripeCheckout: vi.fn(),
  getOrderStatus: vi.fn(),
  CraftCloudApiError: MockCraftCloudApiError,
}));

const insertValues = vi.fn();
const insertReturning = vi.fn(() => [{ id: "order-vg-1" }]);
const deleteWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => cartItemsRows,
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (v: unknown) => {
        insertValues(table?.__name, v);
        return { returning: () => insertReturning() };
      },
    }),
    delete: () => ({
      where: (w: unknown) => {
        deleteWhere(w);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: { __name: "printOrders", id: "id" },
  printOrderItems: { __name: "printOrderItems" },
  cartItems: {
    __name: "cartItems",
    id: "id",
    userId: "user_id",
    vendorId: "vendor_id",
  },
  fileAssets: { __name: "fileAssets", id: "id" },
  files: { __name: "files", id: "id" },
}));

const mockGetCheckoutModel = vi.fn(
  (): "single" | "two_step" => "single"
);
vi.mock("@/lib/env", () => ({
  getCheckoutModel: () => mockGetCheckoutModel(),
  isSandboxMode: vi.fn(() => true),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { checkoutVendorGroup } from "../print";

function makeCartItem(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: "ci-1",
    userId: "test-user-id",
    fileAssetId: "asset-1",
    quoteId: "quote-1",
    vendorId: "vendor-1",
    vendorName: "Unionfab",
    materialConfigId: "pla-white",
    shippingId: "ship-1",
    quantity: 1,
    materialPrice: 1000, // cents, unit price
    shippingPrice: 500, // cents
    currency: "USD",
    countryCode: "US",
    ...overrides,
  };
}

function findInsert(name: "printOrders" | "printOrderItems") {
  return insertValues.mock.calls.find(([tableName]) => tableName === name);
}

describe("checkoutVendorGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartItemsRows = [makeCartItem()];
    mockCreateCart.mockResolvedValue({
      cartId: "cart-vg-1",
      currency: "USD",
    });
    insertReturning.mockReturnValue([{ id: "order-vg-1" }]);
    mockGetCheckoutModel.mockReturnValue("single");
  });

  it("returns an error when the cart has no items for this vendor", async () => {
    cartItemsRows = [];

    const result = await checkoutVendorGroup("vendor-1");

    expect(result).toEqual({ error: "No items in cart for this vendor" });
    expect(mockCreateCart).not.toHaveBeenCalled();
  });

  it("happy path: creates the CraftCloud cart, inserts order + items, deletes cart rows", async () => {
    cartItemsRows = [makeCartItem()];

    const result = await checkoutVendorGroup("vendor-1");

    expect(result).toEqual({ orderId: "order-vg-1", cartId: "cart-vg-1" });
    expect(mockCreateCart).toHaveBeenCalledWith({
      shippingIds: ["ship-1"],
      currency: "USD",
      quotes: [{ id: "quote-1" }],
    });

    const orderInsert = findInsert("printOrders");
    expect(orderInsert).toBeDefined();
    expect(orderInsert![1]).toMatchObject({
      userId: "test-user-id",
      fileAssetId: null,
      craftCloudCartId: "cart-vg-1",
      vendor: "vendor-1",
      vendorName: "Unionfab",
      status: "cart_created",
      checkoutModel: "single",
      // materialPrice=1000 cents * qty 1 = 1000 preShippingTotal (no
      // production fee); shipping deduped to 500; total 1500.
      shippingSubtotal: 500,
      totalPrice: 1500,
      serviceFee: 30, // round(1000 * 0.03)
    });

    const itemsInsert = findInsert("printOrderItems");
    expect(itemsInsert).toBeDefined();
    expect(itemsInsert![1]).toEqual([
      expect.objectContaining({
        printOrderId: "order-vg-1",
        fileAssetId: "asset-1",
        quoteId: "quote-1",
        vendorId: "vendor-1",
        vendorName: "Unionfab",
        materialConfigId: "pla-white",
        quantity: 1,
        materialSubtotal: 1000,
        // Per-item shippingSubtotal always zeroed — canonical total
        // lives on the order row (dedupe-doubling fix).
        shippingSubtotal: 0,
      }),
    ]);

    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("dedupes shipping across multiple cart items sharing a shippingId (no double-charge)", async () => {
    cartItemsRows = [
      makeCartItem({
        id: "ci-1",
        quoteId: "q-1",
        shippingId: "ship-1",
        shippingPrice: 500,
        materialPrice: 1000,
        quantity: 1,
      }),
      makeCartItem({
        id: "ci-2",
        quoteId: "q-2",
        shippingId: "ship-1",
        shippingPrice: 500,
        materialPrice: 800,
        quantity: 2,
      }),
    ];

    await checkoutVendorGroup("vendor-1");

    // Both items share shippingId "ship-1" — createCart should only
    // get it once (Set dedupe on the call), and the stored total
    // should count the fee once, not twice.
    expect(mockCreateCart).toHaveBeenCalledWith(
      expect.objectContaining({ shippingIds: ["ship-1"] })
    );

    const orderInsert = findInsert("printOrders");
    // totalMaterial = 1000*1 + 800*2 = 2600; totalShipping deduped = 500
    expect(orderInsert![1]).toMatchObject({
      shippingSubtotal: 500,
      totalPrice: 3100,
      serviceFee: 78, // round(2600 * 0.03)
    });
  });

  it("sums shipping for items with genuinely different shippingIds", async () => {
    cartItemsRows = [
      makeCartItem({
        id: "ci-1",
        quoteId: "q-1",
        shippingId: "ship-1",
        shippingPrice: 500,
        materialPrice: 1000,
        quantity: 1,
      }),
      makeCartItem({
        id: "ci-2",
        quoteId: "q-2",
        shippingId: "ship-2",
        shippingPrice: 300,
        materialPrice: 800,
        quantity: 1,
      }),
    ];

    await checkoutVendorGroup("vendor-1");

    expect(mockCreateCart).toHaveBeenCalledWith(
      expect.objectContaining({ shippingIds: ["ship-1", "ship-2"] })
    );

    const orderInsert = findInsert("printOrders");
    expect(orderInsert![1]).toMatchObject({
      shippingSubtotal: 800, // 500 + 300, not deduped (different ids)
    });
  });

  it("applies the vendor minimum production fee to the pre-shipping total", async () => {
    mockCreateCart.mockResolvedValueOnce({
      cartId: "cart-vg-2",
      currency: "USD",
      minimumProductionPrice: {
        "vendor-1": { price: 20, productionFee: 5 }, // dollars
      },
    });
    cartItemsRows = [
      makeCartItem({ materialPrice: 1000, quantity: 1, shippingPrice: 500 }),
    ];

    await checkoutVendorGroup("vendor-1");

    const orderInsert = findInsert("printOrders");
    // preShippingTotal = 1000 + 500 (production fee in cents) = 1500
    // totalPrice = 1500 + 500 shipping = 2000
    expect(orderInsert![1]).toMatchObject({
      totalPrice: 2000,
      serviceFee: 45, // round(1500 * 0.03)
    });
  });

  it("getCheckoutModel() === 'single' stamps the order single with no fee clamp", async () => {
    mockGetCheckoutModel.mockReturnValue("single");
    cartItemsRows = [
      makeCartItem({ materialPrice: 1, quantity: 1, shippingPrice: 0 }),
    ];

    await checkoutVendorGroup("vendor-1");

    const orderInsert = findInsert("printOrders");
    // preShippingTotal = 1 cent; single model does not clamp — fee
    // rounds down to 0.
    expect(orderInsert![1]).toMatchObject({
      checkoutModel: "single",
      serviceFee: 0,
    });
  });

  it("getCheckoutModel() === 'two_step' stamps the order two_step and clamps the fee to Stripe's 50-cent minimum", async () => {
    mockGetCheckoutModel.mockReturnValue("two_step");
    cartItemsRows = [
      makeCartItem({ materialPrice: 1, quantity: 1, shippingPrice: 0 }),
    ];

    await checkoutVendorGroup("vendor-1");

    const orderInsert = findInsert("printOrders");
    expect(orderInsert![1]).toMatchObject({
      checkoutModel: "two_step",
      serviceFee: 50, // clamped — round(1 * 0.03) = 0, below the min
    });
  });

  it("CON-138: quote-expired CraftCloudApiError returns an actionable, safe message", async () => {
    mockCreateCart.mockRejectedValueOnce(
      new MockCraftCloudApiError(
        400,
        "Quote not found or expired",
        "/v5/carts"
      )
    );

    const result = await checkoutVendorGroup("vendor-1");

    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/expired|remove those items/i);
    expect(result.error).not.toContain("/v5/");
  });

  it("CON-138: non-expired CraftCloudApiError returns a generic safe message (no leaked internals)", async () => {
    mockCreateCart.mockRejectedValueOnce(
      new MockCraftCloudApiError(
        500,
        "internal /v5/path details leaked here",
        "/v5/carts"
      )
    );

    const result = await checkoutVendorGroup("vendor-1");

    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).not.toContain("/v5/");
    expect(result.error).not.toContain("internal /v5/path details");
    expect(result.error).toMatch(/print partner|try again/i);
  });

  it("non-CraftCloud errors return the generic checkout-failed message", async () => {
    mockCreateCart.mockRejectedValueOnce(new Error("network blip"));

    const result = await checkoutVendorGroup("vendor-1");

    expect(result).toEqual({
      error: "Failed to checkout vendor group. Please try again.",
    });
  });
});
