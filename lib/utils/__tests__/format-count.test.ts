import { describe, it, expect } from "vitest";
import { formatCompactCount } from "../format-count";

describe("formatCompactCount", () => {
  it("renders raw integers below 1000", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(1)).toBe("1");
    expect(formatCompactCount(42)).toBe("42");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("uses k from 1000 up, dropping trailing .0", () => {
    expect(formatCompactCount(1000)).toBe("1k");
    expect(formatCompactCount(1499)).toBe("1.4k");
    expect(formatCompactCount(1500)).toBe("1.5k");
    expect(formatCompactCount(2000)).toBe("2k");
    expect(formatCompactCount(12345)).toBe("12.3k");
    expect(formatCompactCount(999999)).toBe("999.9k");
  });

  it("uses m from 1,000,000 up", () => {
    expect(formatCompactCount(1_000_000)).toBe("1m");
    expect(formatCompactCount(2_500_000)).toBe("2.5m");
    expect(formatCompactCount(12_300_000)).toBe("12.3m");
  });

  it("uses b from 1,000,000,000 up", () => {
    expect(formatCompactCount(1_000_000_000)).toBe("1b");
    expect(formatCompactCount(7_400_000_000)).toBe("7.4b");
  });

  it("clamps negatives and non-finite values to 0", () => {
    expect(formatCompactCount(-5)).toBe("0");
    expect(formatCompactCount(NaN)).toBe("0");
    expect(formatCompactCount(Infinity)).toBe("0");
  });

  it("floors fractional inputs", () => {
    expect(formatCompactCount(42.7)).toBe("42");
    expect(formatCompactCount(1234.9)).toBe("1.2k");
  });
});
