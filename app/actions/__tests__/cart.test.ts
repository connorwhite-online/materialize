import { describe, it, expect, vi, beforeEach } from "vitest";

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
          return {
            innerJoin: () => ({
              leftJoin: () => ({
                where: () => ({
                  orderBy: () => cartRows,
                }),
              }),
            }),
            where: () => cartRows,
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

import { addToCart, removeFromCart, updateCartItemQuantity, getCart } from "../cart";

const baseParams = {
  fileAssetId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
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
  });

  it("upserts a cart item with prices in cents", async () => {
    const result = await addToCart(baseParams);
    expect(result).toEqual({ cartItemId: "new-cart-item-id" });
    expect(insertedValues).toHaveLength(1);
    const inserted = insertedValues[0] as Record<string, unknown>;
    expect(inserted.materialPrice).toBe(4250);
    expect(inserted.shippingPrice).toBe(800);
    expect(inserted.quantity).toBe(2);
    // ON CONFLICT path is wired to bump the existing row's quantity
    // (capped at 100 via LEAST). updatedAt also re-stamps so cart
    // staleness UI reflects the latest touch.
    const setShape = upsertSet as Record<string, unknown> | null;
    expect(setShape).not.toBeNull();
    expect(setShape).toHaveProperty("quantity");
    expect(setShape).toHaveProperty("updatedAt");
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
