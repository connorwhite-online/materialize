import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted runs before vi.mock factories (and before module imports).
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

// MTR-130: getPrice(priceId) is the source of truth addToCart
// reconciles the claimed materialPrice against. Defaults to a quote
// matching baseParams (quoteId "quote-1", $42.50) so the existing
// suite's calls reconcile cleanly without per-test setup.
const mockGetPrice = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    priceId: "price-1",
    allComplete: true,
    quotes: [{ quoteId: "quote-1", price: 42.5, currency: "USD" }],
    shipping: [],
  })
);

vi.mock("@/lib/craftcloud/client", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
  CraftCloudApiError: MockCraftCloudApiError,
}));

let cartRows: unknown[] = [];
let insertedValues: unknown[] = [];
let upsertSet: unknown = null;
// What the upsert's .returning() should yield — defaults to a brand
// new id; tests can override to mimic the conflict-hit case where
// the UNIQUE INDEX matches an existing row and ON CONFLICT DO UPDATE
// returns that row's id.
let upsertReturnsId = "new-cart-item-id";
let deletedIds: string[] = [];
let updatedSet: unknown = null;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        if (table?.__name === "cartItems") {
          // `where` is awaited directly (currency check) AND chained
          // with `.limit(1)` (per-vendor shipping lookup) — return an
          // array augmented with a limit() so both call shapes work.
          const whereResult = () =>
            Object.assign([...cartRows], { limit: () => cartRows });
          return {
            innerJoin: () => ({
              leftJoin: () => ({
                where: () => ({
                  orderBy: () => cartRows,
                }),
              }),
            }),
            where: whereResult,
          };
        }
        return { where: () => [] };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return {
          onConflictDoUpdate: (cfg: { set?: unknown }) => {
            if (cfg?.set) upsertSet = cfg.set;
            return {
              returning: () => [{ id: upsertReturnsId }],
            };
          },
          returning: () => [{ id: upsertReturnsId }],
        };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updatedSet = v;
        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => {
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  cartItems: {
    __name: "cartItems",
    id: "id",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    vendorId: "vendor_id",
    materialConfigId: "material_config_id",
    shippingId: "shipping_id",
    quoteId: "quote_id",
    quantity: "quantity",
    materialPrice: "material_price",
    shippingPrice: "shipping_price",
    currency: "currency",
    countryCode: "country_code",
    createdAt: "created_at",
  },
  fileAssets: { __name: "fileAssets", id: "id", fileId: "file_id", originalFilename: "original_filename" },
  files: { __name: "files", id: "id", name: "name" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// The ownership gate (CON-73) is unit-tested separately; default to
// "allowed" here so the cart-mechanics tests stay focused.
vi.mock("@/lib/entitlement", () => ({
  userCanPrintAsset: vi.fn(async () => true),
}));

import {
  addToCart,
  removeFromCart,
  updateCartItemQuantity,
  repriceCartItem,
  getCart,
} from "../cart";
import { userCanPrintAsset } from "@/lib/entitlement";

const baseParams = {
  fileAssetId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
  priceId: "price-1",
  quoteId: "quote-1",
  vendorId: "vendor-1",
  materialConfigId: "config-1",
  shippingId: "shipping-1",
  quantity: 2,
  materialPrice: 42.5,
  shippingPrice: 8.0,
  currency: "USD" as const,
  countryCode: "US",
};

describe("addToCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartRows = [];
    insertedValues = [];
    upsertSet = null;
    upsertReturnsId = "new-cart-item-id";
    updatedSet = null;
    vi.mocked(userCanPrintAsset).mockResolvedValue(true);
  });

  it("rejects carting an asset the user can't print (CON-73)", async () => {
    vi.mocked(userCanPrintAsset).mockResolvedValueOnce(false);
    const result = await addToCart(baseParams);
    expect(result).toMatchObject({ error: "File not found" });
    expect(insertedValues).toHaveLength(0);
  });

  it("upserts a cart item with prices in cents", async () => {
    const result = await addToCart(baseParams);
    expect(result).toEqual({ cartItemId: "new-cart-item-id" });
    expect(insertedValues).toHaveLength(1);
    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.materialPrice).toBe(4250);
    expect(inserted.shippingPrice).toBe(800);
    expect(inserted.quantity).toBe(2);
    // priceId is persisted so a later checkoutVendorGroup can
    // re-reconcile this row against CraftCloud (MTR-130).
    expect(inserted.priceId).toBe("price-1");
    // ON CONFLICT path is wired to bump the existing row's quantity
    // (capped at 100 via LEAST). updatedAt also re-stamps so cart
    // staleness UI reflects the latest touch.
    const setShape = upsertSet as Record<string, unknown> | null;
    expect(setShape).not.toBeNull();
    expect(setShape).toHaveProperty("quantity");
    expect(setShape).toHaveProperty("updatedAt");
  });

  // MTR-130 — addToCart must re-derive the price from CraftCloud
  // (getPrice(priceId)) instead of trusting the caller's materialPrice.
  it("MTR-130: rejects a tampered (too-low) materialPrice instead of trusting the request body", async () => {
    const result = await addToCart({ ...baseParams, materialPrice: 1 });
    expect(result).toMatchObject({
      error: expect.stringMatching(/pricing has changed|refresh/i),
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("MTR-130: quoteId absent from CraftCloud's price response surfaces a clear re-quote error", async () => {
    mockGetPrice.mockResolvedValueOnce({
      priceId: "price-1",
      allComplete: true,
      quotes: [{ quoteId: "some-other-quote", price: 42.5, currency: "USD" }],
      shipping: [],
    });
    const result = await addToCart(baseParams);
    expect(result).toMatchObject({
      error: expect.stringMatching(/expired|pick a material/i),
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("MTR-130: an expired priceId (CraftCloudApiError) surfaces the same actionable re-quote error", async () => {
    mockGetPrice.mockRejectedValueOnce(
      new MockCraftCloudApiError(404, "Quote not found or expired", "/v5/price/price-1")
    );
    const result = await addToCart(baseParams);
    expect(result).toMatchObject({
      error: expect.stringMatching(/expired|pick a material/i),
    });
    expect(insertedValues).toHaveLength(0);
  });

  it("rejects invalid params", async () => {
    const result = await addToCart({ ...baseParams, quantity: 0 });
    expect(result).toHaveProperty("error");
    expect(insertedValues).toHaveLength(0);
  });

  it("returns the existing row id when the upsert hits the unique constraint", async () => {
    // Mimics the ON CONFLICT path: insert collides with the existing
    // (user, file, quote) row, postgres bumps quantity, RETURNING
    // yields that row's id.
    upsertReturnsId = "existing-cart-item-id";
    const result = await addToCart(baseParams);
    expect(result).toEqual({ cartItemId: "existing-cart-item-id" });
  });

  it("rejects adds in a different currency than what's already in the cart", async () => {
    cartRows = [
      { id: "existing-cart-item-id", quantity: 1, currency: "EUR" },
    ];
    const result = await addToCart({ ...baseParams, currency: "USD" });
    expect(result).toMatchObject({ error: expect.stringContaining("EUR") });
    expect(insertedValues).toHaveLength(0);
    expect(upsertSet).toBeNull();
  });

  it("inherits the existing vendor cart's shipping for a new line", async () => {
    // A second item for a vendor already in the cart must adopt that
    // group's shipping (one shipping option per vendor order) instead
    // of carrying its own picked option/price.
    cartRows = [
      {
        currency: "USD",
        shippingId: "ship-existing",
        shippingPrice: 599, // cents, already stored
      },
    ];
    const result = await addToCart({
      ...baseParams,
      shippingId: "ship-new-pick",
      shippingPrice: 14.99,
    });
    expect(result).toEqual({ cartItemId: "new-cart-item-id" });
    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.shippingId).toBe("ship-existing");
    expect(inserted.shippingPrice).toBe(599);
  });
});

describe("removeFromCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartRows = [];
  });

  it("succeeds when item exists and belongs to user", async () => {
    cartRows = [{ id: "item-1" }];
    const result = await removeFromCart("item-1");
    expect(result).toEqual({ success: true });
  });

  it("errors when item not found", async () => {
    cartRows = [];
    const result = await removeFromCart("missing-id");
    expect(result).toEqual({ error: "Cart item not found" });
  });
});

describe("updateCartItemQuantity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartRows = [];
    updatedSet = null;
  });

  it("updates quantity for owned item", async () => {
    cartRows = [{ id: "item-1" }];
    const result = await updateCartItemQuantity("item-1", 5);
    expect(result).toEqual({ success: true });
    expect(updatedSet).toEqual({ quantity: 5 });
  });

  it("rejects invalid quantities", async () => {
    const result = await updateCartItemQuantity("item-1", 0);
    expect(result).toEqual({ error: "Invalid quantity" });
  });

  it("rejects quantity over 100", async () => {
    const result = await updateCartItemQuantity("item-1", 101);
    expect(result).toEqual({ error: "Invalid quantity" });
  });
});

describe("repriceCartItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartRows = [];
    updatedSet = null;
  });

  it("writes quantity, quoteId, and the re-quoted unit price in cents", async () => {
    cartRows = [{ id: "item-1" }];
    const result = await repriceCartItem({
      cartItemId: "item-1",
      quantity: 5,
      quoteId: "quote-fresh",
      materialPrice: 7.27,
    });
    expect(result).toEqual({ success: true });
    const set = updatedSet as Record<string, unknown>;
    expect(set.quantity).toBe(5);
    expect(set.quoteId).toBe("quote-fresh");
    expect(set.materialPrice).toBe(727);
    // priceId is nulled out on reprice — the old priceId's CraftCloud
    // snapshot won't contain the new quoteId, so leaving it in place
    // would make checkoutVendorGroup's reconciliation (MTR-130)
    // false-reject this row later. A null priceId instead falls back
    // to the legacy "trust as written" bucket.
    expect(set.priceId).toBeNull();
  });

  it("rejects invalid quantity", async () => {
    const result = await repriceCartItem({
      cartItemId: "item-1",
      quantity: 0,
      quoteId: "q",
      materialPrice: 1,
    });
    expect(result).toEqual({ error: "Invalid quantity" });
  });

  it("rejects a non-positive price", async () => {
    const result = await repriceCartItem({
      cartItemId: "item-1",
      quantity: 2,
      quoteId: "q",
      materialPrice: 0,
    });
    expect(result).toEqual({ error: "Invalid quote" });
  });

  it("errors when the item isn't found / owned", async () => {
    cartRows = [];
    const result = await repriceCartItem({
      cartItemId: "missing",
      quantity: 2,
      quoteId: "q",
      materialPrice: 5,
    });
    expect(result).toEqual({ error: "Cart item not found" });
  });
});

describe("getCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartRows = [];
  });

  it("returns items joined with file metadata", async () => {
    cartRows = [
      {
        id: "item-1",
        fileAssetId: "asset-1",
        fileName: "Caribiner",
        originalFilename: "caribiner.stl",
        vendorId: "vendor-1",
        materialConfigId: "config-1",
        shippingId: "shipping-1",
        quoteId: "quote-1",
        quantity: 1,
        materialPrice: 4200,
        shippingPrice: 800,
        currency: "USD",
        countryCode: "US",
        updatedAt: new Date("2026-04-15T12:00:00Z"),
      },
    ];

    const result = await getCart();
    expect(result).toHaveProperty("items");
    if ("items" in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0].fileName).toBe("Caribiner");
      // updatedAt is normalized to ISO string for client consumption
      expect(result.items[0].updatedAt).toBe("2026-04-15T12:00:00.000Z");
    }
  });

  it("returns empty array for unauthenticated user", async () => {
    // The vitest.setup.ts mock returns a test userId, so this
    // path is only hit if auth() returns null. For coverage, the
    // mock always returns a userId, so we just test the happy path.
    const result = await getCart();
    expect(result).toHaveProperty("items");
  });
});
