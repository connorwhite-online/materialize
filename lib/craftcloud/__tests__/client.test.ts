import { describe, it, expect, vi, beforeEach } from "vitest";

// Force mock mode for these tests
vi.stubEnv("CRAFTCLOUD_USE_MOCK", "true");

import {
  uploadModel,
  getModel,
  createPriceRequest,
  getPrice,
  createCart,
  createOrder,
  getOrderStatus,
  createStripeCheckout,
} from "../client";

describe("CraftCloud client (mock mode)", () => {
  it("uploadModel returns model with geometry", async () => {
    const buffer = new Uint8Array([1, 2, 3]);
    const model = await uploadModel(buffer, "test.stl", "mm");
    expect(model.id).toContain("mock-model");
    expect(model.filename).toBe("test.stl");
    expect(model.fileUnit).toBe("mm");
    expect(model.geometry).toBeDefined();
    expect(model.geometry!.dimensions).toEqual({ x: 50, y: 30, z: 20 });
    expect(model.status).toBe("ready");
  });

  it("getModel returns model with parsing false", async () => {
    const model = await getModel("some-model-id");
    expect(model.id).toBe("some-model-id");
    expect(model.parsing).toBe(false);
  });

  it("createPriceRequest returns priceId", async () => {
    const result = await createPriceRequest({
      currency: "USD",
      countryCode: "US",
      models: [{ modelId: "test", quantity: 1 }],
    });
    expect(result.priceId).toContain("mock-price");
  });

  it("getPrice returns quotes and shipping", async () => {
    const result = await getPrice("test-price-id");
    expect(result.priceId).toBe("test-price-id");
    expect(result.allComplete).toBe(true);
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(result.shipping.length).toBeGreaterThan(0);

    // Verify quote structure
    const quote = result.quotes[0];
    expect(quote).toHaveProperty("quoteId");
    expect(quote).toHaveProperty("vendorId");
    expect(quote).toHaveProperty("materialConfigId");
    expect(quote).toHaveProperty("price");
    expect(quote.price).toBeGreaterThan(0);

    // Verify shipping structure
    const ship = result.shipping[0];
    expect(ship).toHaveProperty("shippingId");
    expect(ship).toHaveProperty("vendorId");
    expect(ship).toHaveProperty("type");
    expect(["standard", "express"]).toContain(ship.type);
  });

  it("getPrice returns quotes for all materials", async () => {
    const result = await getPrice("test-price-id");
    const materialIds = [...new Set(result.quotes.map((q) => q.materialConfigId))];
    expect(materialIds.length).toBe(10); // 10 mock materials
  });

  it("getPrice returns shipping for all vendors", async () => {
    const result = await getPrice("test-price-id");
    const vendorIds = [...new Set(result.shipping.map((s) => s.vendorId))];
    expect(vendorIds.length).toBe(3); // 3 mock vendors
  });

  it("createCart returns cartId and currency", async () => {
    const cart = await createCart({
      shippingIds: ["ship-1"],
      currency: "USD",
      quotes: [{ id: "q1" }],
    });
    expect(cart.cartId).toContain("mock-cart");
    expect(cart.currency).toBe("USD");
  });

  it("createOrder returns orderId", async () => {
    const order = await createOrder({
      cartId: "cart-1",
      user: {
        emailAddress: "test@test.com",
        shipping: {
          firstName: "Test",
          lastName: "User",
          address: "123 Main St",
          city: "Test City",
          zipCode: "12345",
          countryCode: "US",
        },
        billing: {
          firstName: "Test",
          lastName: "User",
          address: "123 Main St",
          city: "Test City",
          zipCode: "12345",
          countryCode: "US",
          isCompany: false,
        },
      },
    });
    expect(order.orderId).toContain("mock-order");
    expect(order.status).toBe("ordered");
  });

  it("getOrderStatus returns vendor statuses", async () => {
    const status = await getOrderStatus("order-1");
    expect(status.orderId).toBe("order-1");
    expect(status.vendorStatuses).toHaveLength(1);
    expect(status.vendorStatuses[0].status).toBe("in_production");
  });

  it("createStripeCheckout returns session URL", async () => {
    const result = await createStripeCheckout({
      orderId: "order-1",
      returnUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(result.sessionId).toContain("mock-session");
    expect(result.sessionUrl).toBe("https://example.com/success");
  });
});

describe("CraftCloud mock data quality", () => {
  it("quotes have positive prices", async () => {
    const result = await getPrice("test-price-id");
    for (const quote of result.quotes) {
      expect(quote.price).toBeGreaterThan(0);
    }
  });

  it("shipping has correct types", async () => {
    const result = await getPrice("test-price-id");
    for (const ship of result.shipping) {
      expect(["standard", "express"]).toContain(ship.type);
      expect(ship.price).toBeGreaterThan(0);
      expect(ship.carrier).toBeTruthy();
    }
  });

  it("every vendor has both standard and express shipping", async () => {
    const result = await getPrice("test-price-id");
    const vendorIds = [...new Set(result.shipping.map((s) => s.vendorId))];
    for (const vendorId of vendorIds) {
      const types = result.shipping
        .filter((s) => s.vendorId === vendorId)
        .map((s) => s.type);
      expect(types).toContain("standard");
      expect(types).toContain("express");
    }
  });
});
