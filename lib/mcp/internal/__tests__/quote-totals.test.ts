import { describe, it, expect } from "vitest";
import { byBuyerTotal, quoteTotals } from "../quote-totals";

const noMinimums = new Map<string, number>();

describe("quoteTotals", () => {
  it("adds shipping and the 3% service fee on the pre-shipping subtotal", () => {
    const t = quoteTotals(
      { vendorId: "v1", priceCents: 354, shippingPriceCents: 745 },
      1,
      new Map([["v1", 0]])
    );
    expect(t).toEqual({
      minimumFeeCents: 0,
      minimumKnown: true,
      serviceFeeCents: 11,
      totalCents: 354 + 745 + 11,
    });
  });

  it("tops production up to the vendor minimum, and charges the fee on that", () => {
    const t = quoteTotals(
      { vendorId: "panashape", priceCents: 727, shippingPriceCents: 500 },
      1,
      new Map([["panashape", 33]])
    );
    expect(t.minimumFeeCents).toBe(3300 - 727);
    expect(t.serviceFeeCents).toBe(99);
    expect(t.totalCents).toBe(3300 + 500 + 99);
  });

  it("applies the minimum to the order, not per unit", () => {
    const t = quoteTotals(
      { vendorId: "v", priceCents: 1000, shippingPriceCents: 0 },
      4,
      new Map([["v", 33]])
    );
    expect(t.minimumFeeCents).toBe(0);
    expect(t.totalCents).toBe(4000 + 120);
  });

  it("flags an unprobed vendor and leaves the total null without shipping", () => {
    const t = quoteTotals(
      { vendorId: "v", priceCents: 500, shippingPriceCents: null },
      1,
      noMinimums
    );
    expect(t.minimumKnown).toBe(false);
    expect(t.totalCents).toBeNull();
  });
});

describe("byBuyerTotal", () => {
  it("ranks by what the buyer pays, so a cheap item at a minimum vendor drops", () => {
    const cheapItem = { priceCents: 727, totalCents: 3899 };
    const dearerItem = { priceCents: 1200, totalCents: 1736 };
    const noShipping = { priceCents: 100, totalCents: null };
    expect(
      [cheapItem, noShipping, dearerItem].sort(byBuyerTotal)
    ).toEqual([dearerItem, cheapItem, noShipping]);
  });
});
