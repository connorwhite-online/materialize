import { describe, it, expect } from "vitest";
import {
  calcServiceFee,
  TWO_STEP_FEE_MIN_CENTS,
  TWO_STEP_FEE_MAX_CENTS,
} from "../fees";

describe("calcServiceFee", () => {
  describe("rounding table (single model)", () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 0],
      [16, 0],
      [17, 1],
      [50, 2],
      [100, 3],
      [333, 10],
      [1000, 30],
      [1666, 50],
      [99999999, 3000000],
    ];

    it.each(cases)(
      "calcServiceFee(%i) === %i",
      (input, expected) => {
        expect(calcServiceFee(input)).toBe(expected);
      }
    );
  });

  describe("two_step floor and cap", () => {
    // Floor rationale: Stripe takes 2.9% + 30¢ per charge, so an
    // unclamped 3% fee nets NEGATIVE below a ~$10 subtotal. The 99¢
    // floor keeps every order profitable and satisfies Stripe's hard
    // 50¢ minimum charge.
    it("clamps small-order fees up to the 99-cent floor", () => {
      expect(calcServiceFee(0, "two_step")).toBe(TWO_STEP_FEE_MIN_CENTS);
      expect(calcServiceFee(1000, "two_step")).toBe(TWO_STEP_FEE_MIN_CENTS); // 3% = 30¢
      expect(calcServiceFee(3200, "two_step")).toBe(TWO_STEP_FEE_MIN_CENTS); // 3% = 96¢
    });

    it("floor boundary: 3% takes over above a $33 subtotal", () => {
      // 3300 cents → 99¢ exactly; 3400 → 102¢ (above floor).
      expect(calcServiceFee(3300, "two_step")).toBe(99);
      expect(calcServiceFee(3400, "two_step")).toBe(102);
    });

    it("passes the pure 3% through in the unclamped band", () => {
      expect(calcServiceFee(5000, "two_step")).toBe(150);
      expect(calcServiceFee(10000, "two_step")).toBe(300);
    });

    // Cap rationale: under two_step the customer sees the fee as its
    // own separate charge; the cap keeps big carts from displaying a
    // scrutiny-inviting line item.
    it("clamps big-cart fees down to the $5 cap", () => {
      // 3% of 16700 = 501 → capped to 500.
      expect(calcServiceFee(16700, "two_step")).toBe(TWO_STEP_FEE_MAX_CENTS);
    });

    it("cap boundary: binds above a ~$167 subtotal", () => {
      expect(calcServiceFee(16666, "two_step")).toBe(500); // 3% = 499.98 → 500, at cap naturally
      expect(calcServiceFee(20000, "two_step")).toBe(TWO_STEP_FEE_MAX_CENTS); // 3% = 600 → capped
      expect(calcServiceFee(100000, "two_step")).toBe(TWO_STEP_FEE_MAX_CENTS); // $1000 cart → $5
    });

    // The floor exists partly because Stripe rejects sub-50¢ charges
    // on a fee-only session. If someone tunes the floor, this guard
    // makes the Stripe constraint impossible to violate silently.
    it("floor constant never violates Stripe's 50-cent minimum", () => {
      expect(TWO_STEP_FEE_MIN_CENTS).toBeGreaterThanOrEqual(50);
      expect(TWO_STEP_FEE_MAX_CENTS).toBeGreaterThan(TWO_STEP_FEE_MIN_CENTS);
    });

    // The clamp is deliberately two_step-scoped. Single-model orders
    // keep pure 3%, and so do digital listing purchases (checkout.ts
    // passes no model) — there the fee comes out of the CREATOR's
    // payout, and a 99¢ floor on a $5 file would turn 3% into 20% at
    // the creator's expense.
    it("does NOT clamp for single model (default)", () => {
      expect(calcServiceFee(1000, "single")).toBe(30);
      expect(calcServiceFee(1000)).toBe(30);
      expect(calcServiceFee(100000)).toBe(3000); // no cap either
    });
  });
});
