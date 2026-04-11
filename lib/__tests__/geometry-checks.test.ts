import { describe, it, expect } from "vitest";
import { checkGeometry } from "../geometry-checks";

describe("checkGeometry", () => {
  it("returns empty for null geometry", () => {
    expect(checkGeometry(null)).toEqual([]);
  });

  it("returns empty for normal geometry", () => {
    const hints = checkGeometry({
      dimensions: { x: 50, y: 30, z: 20 },
      volume: 15000,
      triangleCount: 12500,
    });
    expect(hints).toEqual([]);
  });

  it("warns about near-zero volume with large bounding box", () => {
    const hints = checkGeometry({
      dimensions: { x: 50, y: 30, z: 20 },
      volume: 0.01,
    });
    expect(hints.length).toBe(1);
    expect(hints[0].message).toContain("geometry issues");
  });

  it("does not warn about low volume with small bounding box", () => {
    const hints = checkGeometry({
      dimensions: { x: 1, y: 1, z: 1 },
      volume: 0.05,
    });
    expect(hints).toEqual([]);
  });

  it("hints about large models", () => {
    const hints = checkGeometry({
      dimensions: { x: 500, y: 200, z: 200 },
      volume: 5000000,
    });
    expect(hints.some((h) => h.message.includes("Large"))).toBe(true);
  });

  it("does not flag normal-sized models", () => {
    const hints = checkGeometry({
      dimensions: { x: 300, y: 200, z: 200 },
      volume: 5000000,
    });
    expect(hints).toEqual([]);
  });

  it("hints about high polygon count", () => {
    const hints = checkGeometry({
      dimensions: { x: 50, y: 50, z: 50 },
      volume: 100000,
      triangleCount: 6_000_000,
    });
    expect(hints.some((h) => h.message.includes("polygon"))).toBe(true);
  });

  it("does not flag normal polygon count", () => {
    const hints = checkGeometry({
      dimensions: { x: 50, y: 50, z: 50 },
      volume: 100000,
      triangleCount: 100_000,
    });
    expect(hints).toEqual([]);
  });

  it("never returns error-level issues (only hints)", () => {
    // Even with terrible geometry, should only be hints
    const hints = checkGeometry({
      dimensions: { x: 600, y: 0.1, z: 0.1 },
      volume: 0.001,
      triangleCount: 10_000_000,
    });
    // All should be hint-level, no "type: error"
    for (const hint of hints) {
      expect(hint).not.toHaveProperty("type");
    }
  });
});
