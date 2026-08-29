import { describe, it, expect } from "vitest";
import {
  cheapestShippingForVendor,
  shippingOptionsForVendor,
  type ShippingOption,
} from "../shipping-options";

const OPTIONS: ShippingOption[] = [
  {
    shippingId: "exp",
    vendorId: "v1",
    name: "Express",
    deliveryTime: 2,
    price: 18,
    type: "express",
  },
  {
    shippingId: "std",
    vendorId: "v1",
    name: "Standard",
    deliveryTime: 7,
    price: 6,
    type: "standard",
  },
  {
    shippingId: "other",
    vendorId: "v2",
    name: "Other",
    deliveryTime: 4,
    price: 1,
    type: "standard",
  },
  {
    shippingId: "tie-a",
    vendorId: "v3",
    name: "A",
    deliveryTime: 5,
    price: 4,
    type: "standard",
  },
  {
    shippingId: "tie-b",
    vendorId: "v3",
    name: "B",
    deliveryTime: 3,
    price: 4,
    type: "express",
  },
];

describe("cheapestShippingForVendor", () => {
  it("picks the lowest price for that vendor only", () => {
    const cheapest = cheapestShippingForVendor(OPTIONS, "v1");
    expect(cheapest?.shippingId).toBe("std");
    expect(cheapest?.price).toBe(6);
  });

  it("breaks ties in favor of the earlier entry", () => {
    expect(cheapestShippingForVendor(OPTIONS, "v3")?.shippingId).toBe("tie-a");
  });

  it("returns null when the vendor has no options yet", () => {
    expect(cheapestShippingForVendor(OPTIONS, "missing")).toBeNull();
  });
});

describe("shippingOptionsForVendor", () => {
  it("filters and sorts cheapest first without mutating the input", () => {
    const snapshot = OPTIONS.slice();
    const sorted = shippingOptionsForVendor(OPTIONS, "v1");
    expect(sorted.map((s) => s.shippingId)).toEqual(["std", "exp"]);
    expect(OPTIONS).toEqual(snapshot);
  });
});
