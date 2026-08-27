import { describe, it, expect } from "vitest";
import {
  roundedTriangleShape,
  makeRoundedTriangleGeometry,
} from "../rounded-triangle";

describe("roundedTriangleShape", () => {
  it("is a closed triangle with filleted corners, not a sharp yield sign", () => {
    const shape = roundedTriangleShape();
    const points = shape.getPoints(24);
    expect(points.length).toBeGreaterThan(20);

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(height).toBeGreaterThan(width * 0.75);
    expect(height).toBeLessThan(width * 1.15);

    // Sharp equilateral would put a vertex at the exact top. A fillet
    // flattens that into an arc, so several points share the peak band.
    const peak = Math.max(...ys);
    const nearPeak = points.filter((p) => peak - p.y < 0.04);
    expect(nearPeak.length).toBeGreaterThan(2);
  });
});

describe("makeRoundedTriangleGeometry", () => {
  it("winds with outward normals so the FrontSide fill is visible", () => {
    const geometry = makeRoundedTriangleGeometry();
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
    expect(outward).toBeGreaterThan(pos.count * 0.7);
  });
});
