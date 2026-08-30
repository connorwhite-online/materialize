import { describe, it, expect } from "vitest";
import {
  fastestDeliveryByVendor,
  vendorQuoteBadges,
} from "../vendor-badges";

describe("fastestDeliveryByVendor", () => {
  it("keeps the shortest deliveryTime per vendor", () => {
    const map = fastestDeliveryByVendor([
      { vendorId: "a", price: 10, deliveryTime: 7 },
      { vendorId: "a", price: 20, deliveryTime: 3 },
      { vendorId: "b", price: 5, deliveryTime: 5 },
    ]);
    expect(map.get("a")).toBe(3);
    expect(map.get("b")).toBe(5);
  });

  it("treats missing deliveryTime as 0", () => {
    const map = fastestDeliveryByVendor([{ vendorId: "a", price: 10 }]);
    expect(map.get("a")).toBe(0);
  });
});

describe("vendorQuoteBadges", () => {
  const quotes = [
    {
      quoteId: "cheap-slow",
      vendorId: "v1",
      price: 10,
      productionTimeFast: 10,
    },
    {
      quoteId: "pricey-fast",
      vendorId: "v2",
      price: 30,
      productionTimeFast: 2,
    },
    {
      quoteId: "mid",
      vendorId: "v3",
      price: 20,
      productionTimeFast: 5,
    },
  ];

  it("returns no badges for a single quote", () => {
    expect(
      vendorQuoteBadges([quotes[0]], [], 1).size
    ).toBe(0);
  });

  it("marks cheapest by production+shipping total, fastest by production+delivery", () => {
    const shipping = [
      { vendorId: "v1", price: 5, deliveryTime: 7 },
      { vendorId: "v2", price: 5, deliveryTime: 3 },
      { vendorId: "v3", price: 5, deliveryTime: 5 },
    ];
    const badges = vendorQuoteBadges(quotes, shipping, 1);

    // cheap-slow: 10+5=15 cost, 10+7=17 days
    // pricey-fast: 30+5=35 cost, 2+3=5 days
    // mid: 20+5=25 cost, 5+5=10 days
    expect(badges.get("cheap-slow")).toEqual({
      cheapest: true,
      fastest: false,
    });
    expect(badges.get("pricey-fast")).toEqual({
      cheapest: false,
      fastest: true,
    });
    expect(badges.get("mid")).toEqual({
      cheapest: false,
      fastest: false,
    });
  });

  it("lets shipping price overturn a lower production quote", () => {
    const shipping = [
      { vendorId: "v1", price: 50, deliveryTime: 7 },
      { vendorId: "v2", price: 1, deliveryTime: 3 },
      { vendorId: "v3", price: 1, deliveryTime: 5 },
    ];
    const badges = vendorQuoteBadges(quotes, shipping, 1);
    // v1: 10+50=60, v2: 30+1=31, v3: 20+1=21 → mid wins cheapest
    expect(badges.get("mid")?.cheapest).toBe(true);
    expect(badges.get("cheap-slow")?.cheapest).toBe(false);
  });

  it("weights production by sortQuantity for cheapest", () => {
    // Low unit price + high shipping loses once qty amplifies production.
    const quotes = [
      { quoteId: "low-unit", vendorId: "a", price: 5, productionTimeFast: 5 },
      { quoteId: "high-unit", vendorId: "b", price: 8, productionTimeFast: 5 },
    ];
    const shipping = [
      { vendorId: "a", price: 40, deliveryTime: 1 },
      { vendorId: "b", price: 1, deliveryTime: 1 },
    ];
    // qty 1: a=45, b=9 → b; qty 20: a=140, b=161 → a
    expect(
      vendorQuoteBadges(quotes, shipping, 1).get("high-unit")?.cheapest
    ).toBe(true);
    expect(
      vendorQuoteBadges(quotes, shipping, 20).get("low-unit")?.cheapest
    ).toBe(true);
  });

  it("allows one quote to win both chips", () => {
    const only = [
      {
        quoteId: "winner",
        vendorId: "v1",
        price: 1,
        productionTimeFast: 1,
      },
      {
        quoteId: "loser",
        vendorId: "v2",
        price: 100,
        productionTimeFast: 20,
      },
    ];
    const badges = vendorQuoteBadges(only, [], 1);
    expect(badges.get("winner")).toEqual({ cheapest: true, fastest: true });
    expect(badges.get("loser")).toEqual({ cheapest: false, fastest: false });
  });

  it("ties award the chip to every matching quote", () => {
    const tied = [
      { quoteId: "a", vendorId: "a", price: 10, productionTimeFast: 3 },
      { quoteId: "b", vendorId: "b", price: 10, productionTimeFast: 3 },
    ];
    const badges = vendorQuoteBadges(tied, [], 1);
    expect(badges.get("a")).toEqual({ cheapest: true, fastest: true });
    expect(badges.get("b")).toEqual({ cheapest: true, fastest: true });
  });
});
