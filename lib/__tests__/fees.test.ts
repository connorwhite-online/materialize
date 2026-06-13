import { describe, it, expect } from "vitest";
import { calcServiceFee } from "../fees";

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

  describe("two_step model minimum clamp", () => {
    it("clamps to 50 cents minimum for two_step when fee would be below 50", () => {
      // Pre-shipping of 1000 cents (3% = 30 cents) → clamped to 50
      expect(calcServiceFee(1000, "two_step")).toBe(50);
    });

    it("clamps sub-$16.67 orders (fee < 50 cents) to 50 cents", () => {
      // 1666 cents → 49.98 → Math.round = 50 → exactly 50 (no clamp needed at boundary)
      expect(calcServiceFee(1666, "two_step")).toBe(50);
      // 1667 cents → 50.01 → Math.round = 50 → 50 (above clamp)
      expect(calcServiceFee(1667, "two_step")).toBe(50);
      // 1700 cents → 51 → above clamp
      expect(calcServiceFee(1700, "two_step")).toBe(51);
    });

    it("does NOT clamp for single model", () => {
      // 1000 cents → 30 cents (no clamp)
      expect(calcServiceFee(1000, "single")).toBe(30);
      expect(calcServiceFee(1000)).toBe(30);
    });

    it("does not double-clamp: fee above 50 passes through unchanged", () => {
      // 2000 cents → 60 cents → 60 (above clamp)
      expect(calcServiceFee(2000, "two_step")).toBe(60);
    });

    it("zero pre-shipping → zero for single, 50 for two_step", () => {
      expect(calcServiceFee(0, "single")).toBe(0);
      expect(calcServiceFee(0, "two_step")).toBe(50);
    });
  });
});
