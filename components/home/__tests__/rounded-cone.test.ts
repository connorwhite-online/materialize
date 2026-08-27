import { describe, it, expect } from "vitest";
import { roundedConeProfile } from "../rounded-cone";

describe("roundedConeProfile", () => {
  const points = roundedConeProfile();

  it("stays a valid lathe profile (x ≥ 0, tip on the axis)", () => {
    expect(points.length).toBeGreaterThan(8);
    expect(points[0]!.x).toBeLessThan(0.05);
    expect(points.at(-1)!.x).toBeLessThan(0.05);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("is wider at the base than at the tip", () => {
    const maxRadius = Math.max(...points.map((p) => p.x));
    const maxAt = points.find((p) => p.x === maxRadius)!;
    const tipY = points[0]!.y;
    const baseY = points.at(-1)!.y;
    expect(maxRadius).toBeGreaterThan(0.4);
    expect(maxAt.y).toBeLessThan((tipY + baseY) / 2);
    expect(tipY).toBeGreaterThan(baseY);
  });
});
