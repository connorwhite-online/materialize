import { describe, it, expect } from "vitest";
import { expectedSingleItemCheckoutCents } from "../checkout-amount";

describe("expectedSingleItemCheckoutCents", () => {
  it("sums material × qty + shipping + fee when there is no vendor minimum", () => {
    expect(
      expectedSingleItemCheckoutCents({
        totalPrice: 2500,
        serviceFee: 75,
        materialSubtotal: 1000,
        shippingSubtotal: 500,
        quantity: 2,
      })
    ).toBe(2575);
  });

  it("adds the implied vendor-minimum production fee line", () => {
    // $33 minimum on a $7 part + $5 shipping → $21 production fee line.
    expect(
      expectedSingleItemCheckoutCents({
        totalPrice: 3300,
        serviceFee: 99,
        materialSubtotal: 700,
        shippingSubtotal: 500,
        quantity: 1,
      })
    ).toBe(3399);
  });

  it("falls back to totalPrice + fee without a breakdown", () => {
    expect(
      expectedSingleItemCheckoutCents({
        totalPrice: 1234,
        serviceFee: 37,
        materialSubtotal: null,
        shippingSubtotal: null,
        quantity: null,
      })
    ).toBe(1271);
  });
});
