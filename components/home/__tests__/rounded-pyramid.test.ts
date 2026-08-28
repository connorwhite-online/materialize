import { describe, it, expect } from "vitest";
import {
  ROUNDED_PYRAMID_BASE,
  ROUNDED_PYRAMID_BEVEL,
  ROUNDED_PYRAMID_CORNER_RADIUS,
  ROUNDED_PYRAMID_HEIGHT,
  ROUNDED_PYRAMID_TIP_SCALE,
  makeRoundedPyramidGeometry,
  roundedSquareShape,
} from "../rounded-pyramid";

describe("roundedSquareShape", () => {
  it("keeps chubby corner fillets relative to the base", () => {
    expect(ROUNDED_PYRAMID_CORNER_RADIUS / ROUNDED_PYRAMID_BASE).toBeGreaterThan(
      0.18
    );
    expect(ROUNDED_PYRAMID_CORNER_RADIUS / ROUNDED_PYRAMID_BASE).toBeLessThan(
      0.35
    );
    const points = roundedSquareShape().getPoints(24);
    expect(points.length).toBeGreaterThan(16);
  });
});

describe("makeRoundedPyramidGeometry", () => {
  it("is taller than it is wide at the tip — a pyramid, not a token", () => {
    expect(ROUNDED_PYRAMID_HEIGHT).toBeGreaterThan(ROUNDED_PYRAMID_BASE * 0.7);
    expect(ROUNDED_PYRAMID_TIP_SCALE).toBeGreaterThan(0.05);
    expect(ROUNDED_PYRAMID_TIP_SCALE).toBeLessThan(0.25);
    expect(ROUNDED_PYRAMID_BEVEL).toBeGreaterThan(0.04);

    const geometry = makeRoundedPyramidGeometry();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;
    const height = box.max.y - box.min.y;
    geometry.dispose();

    // Tip-up: Y is the tall axis; base spans X/Z similarly.
    expect(height).toBeGreaterThan(width * 0.55);
    expect(Math.abs(width - depth)).toBeLessThan(width * 0.15);
  });

  it("has outward-ish smooth normals (not a flat plate)", () => {
    const geometry = makeRoundedPyramidGeometry();
    const pos = geometry.getAttribute("position");
    const nrm = geometry.getAttribute("normal");
    let outward = 0;
    for (let i = 0; i < pos.count; i++) {
      const d =
        pos.getX(i) * nrm.getX(i) +
        pos.getY(i) * nrm.getY(i) +
        pos.getZ(i) * nrm.getZ(i);
      if (d > 0) outward++;
    }
    geometry.dispose();
    expect(outward).toBeGreaterThan(pos.count * 0.55);
  });
});
