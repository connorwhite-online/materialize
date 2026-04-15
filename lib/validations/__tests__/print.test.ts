import { describe, it, expect } from "vitest";
import { quotesRequestSchema, printOrderSchema } from "../print";

describe("quotesRequestSchema", () => {
  it("accepts a fileAssetId variant with all defaults filled in", () => {
    const result = quotesRequestSchema.safeParse({
      fileAssetId: "3e8a1e2c-4b1a-4c1a-9f1a-1a1a1a1a1a1a",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("USD");
      expect(result.data.countryCode).toBe("US");
      expect(result.data.quantity).toBe(1);
      expect("fileAssetId" in result.data).toBe(true);
    }
  });

  it("accepts a modelId variant (anon draft flow)", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "some-craftcloud-model-id",
      currency: "EUR",
      countryCode: "DE",
      quantity: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("EUR");
      expect(result.data.countryCode).toBe("DE");
      expect(result.data.quantity).toBe(5);
      expect("modelId" in result.data).toBe(true);
    }
  });

  it("rejects neither fileAssetId nor modelId", () => {
    const result = quotesRequestSchema.safeParse({ currency: "USD" });
    expect(result.success).toBe(false);
  });

  it("rejects fileAssetId that isn't a uuid", () => {
    const result = quotesRequestSchema.safeParse({ fileAssetId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported currency", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      currency: "BRL",
    });
    expect(result.success).toBe(false);
  });

  it("rejects countryCode not 2 chars", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      countryCode: "USA",
    });
    expect(result.success).toBe(false);
  });

  it("clamps quantity > 100", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      quantity: 9999,
    });
    expect(result.success).toBe(false);
  });

  it("clamps quantity < 1", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it("coerces numeric strings into quantity", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      quantity: "3",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(3);
    }
  });

  it("passes the optional materialId scope through when provided", () => {
    const result = quotesRequestSchema.safeParse({
      modelId: "x",
      materialId: "mat-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.materialId).toBe("mat-123");
    }
  });
});

describe("printOrderSchema", () => {
  const validOrder = {
    fileAssetId: "3e8a1e2c-4b1a-4c1a-9f1a-1a1a1a1a1a1a",
    quoteId: "quote-1",
    vendorId: "vendor-1",
    materialConfigId: "mat-config-1",
    shippingId: "ship-1",
    quantity: 1,
    materialPrice: 19.99,
    shippingPrice: 5.0,
    currency: "USD" as const,
  };

  it("accepts a valid order", () => {
    const result = printOrderSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
  });

  it("accepts zero shipping price (free shipping)", () => {
    const result = printOrderSchema.safeParse({
      ...validOrder,
      shippingPrice: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero or negative material price", () => {
    expect(
      printOrderSchema.safeParse({ ...validOrder, materialPrice: 0 }).success
    ).toBe(false);
    expect(
      printOrderSchema.safeParse({ ...validOrder, materialPrice: -1 }).success
    ).toBe(false);
  });

  it("rejects negative shipping price", () => {
    const result = printOrderSchema.safeParse({
      ...validOrder,
      shippingPrice: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer quantity", () => {
    const result = printOrderSchema.safeParse({
      ...validOrder,
      quantity: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty string ids", () => {
    expect(
      printOrderSchema.safeParse({ ...validOrder, quoteId: "" }).success
    ).toBe(false);
    expect(
      printOrderSchema.safeParse({ ...validOrder, vendorId: "" }).success
    ).toBe(false);
    expect(
      printOrderSchema.safeParse({ ...validOrder, materialConfigId: "" })
        .success
    ).toBe(false);
    expect(
      printOrderSchema.safeParse({ ...validOrder, shippingId: "" }).success
    ).toBe(false);
  });

  it("rejects unsupported currency", () => {
    const result = printOrderSchema.safeParse({
      ...validOrder,
      currency: "BRL",
    });
    expect(result.success).toBe(false);
  });
});
