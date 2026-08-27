import { describe, it, expect } from "vitest";
import { roundedConeProfile, makeRoundedConeGeometry } from "../rounded-cone";

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

describe("makeRoundedConeGeometry", () => {
  it("winds with outward normals so the FrontSide fill is visible", () => {
    const geometry = makeRoundedConeGeometry();
    const pos = geometry.getAttribute("position");
    const nrm = geometry.getAttribute("normal");
    let outward = 0;
    let inward = 0;
    for (let i = 0; i < pos.count; i++) {
      const d =
        pos.getX(i) * nrm.getX(i) +
        pos.getY(i) * nrm.getY(i) +
        pos.getZ(i) * nrm.getZ(i);
      if (d > 0.01) outward++;
      else if (d < -0.01) inward++;
    }
    geometry.dispose();
    expect(outward).toBeGreaterThan(inward);
    expect(outward).toBeGreaterThan(pos.count * 0.8);
  });
});
