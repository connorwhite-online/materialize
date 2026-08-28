import { describe, it, expect } from "vitest";
import {
  ROUNDED_TRIANGLE_CORNER_RADIUS,
  ROUNDED_TRIANGLE_SIDE,
  roundedTriangleShape,
  makeRoundedTriangleGeometry,
} from "../rounded-triangle";

describe("roundedTriangleShape", () => {
  it("uses a chubby fillet so corners feel pillowy, not sharp", () => {
    expect(ROUNDED_TRIANGLE_CORNER_RADIUS / ROUNDED_TRIANGLE_SIDE).toBeGreaterThan(
      0.14
    );
    expect(ROUNDED_TRIANGLE_CORNER_RADIUS / ROUNDED_TRIANGLE_SIDE).toBeLessThan(
      0.24
    );
  });

  it("is a closed triangle with filleted corners, not a sharp yield sign", () => {
    const shape = roundedTriangleShape();
    const points = shape.getPoints(28);
    expect(points.length).toBeGreaterThan(24);

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // Chubby fillets shorten both axes vs sharp equilateral (~0.866).
    // Base corners cut width a touch more than the tip cuts height, so
    // the ratio can sit near ~0.95 while still reading as a triangle.
    expect(height).toBeGreaterThan(width * 0.7);
    expect(height).toBeLessThan(width * 0.98);

    const peak = Math.max(...ys);
    const nearPeak = points.filter((p) => peak - p.y < 0.06);
    expect(nearPeak.length).toBeGreaterThan(2);

    const sharpPeak = (2 * ((ROUNDED_TRIANGLE_SIDE * Math.sqrt(3)) / 2)) / 3;
    expect(sharpPeak - peak).toBeGreaterThan(ROUNDED_TRIANGLE_CORNER_RADIUS * 0.65);
    expect(sharpPeak - peak).toBeLessThan(ROUNDED_TRIANGLE_CORNER_RADIUS * 1.35);
  });

  it("stays inside the sharp equilateral — fillets cut corners, they don't balloon", () => {
    const side = ROUNDED_TRIANGLE_SIDE;
    const h = (side * Math.sqrt(3)) / 2;
    const a = { x: 0, y: (2 * h) / 3 };
    const b = { x: side / 2, y: -h / 3 };
    const c = { x: -side / 2, y: -h / 3 };
    const sign = (
      p: { x: number; y: number },
      q: { x: number; y: number },
      r: { x: number; y: number }
    ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

    const points = roundedTriangleShape().getPoints(36);
    for (const p of points) {
      expect(sign(a, b, p)).toBeLessThan(1e-4);
      expect(sign(b, c, p)).toBeLessThan(1e-4);
      expect(sign(c, a, p)).toBeLessThan(1e-4);
    }
  });

  it("keeps a readable bottom edge between the two base fillets", () => {
    const side = ROUNDED_TRIANGLE_SIDE;
    const h = (side * Math.sqrt(3)) / 2;
    const bottomY = -h / 3;
    const points = roundedTriangleShape().getPoints(36);
    const onBottom = points.filter((p) => Math.abs(p.y - bottomY) < 0.03);
    expect(onBottom.length).toBeGreaterThanOrEqual(2);
    const xs = onBottom.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(-0.12);
    expect(xs[xs.length - 1]).toBeGreaterThan(0.12);
  });
});

describe("makeRoundedTriangleGeometry", () => {
  it("is a flat face, not an extruded prism", () => {
    const geometry = makeRoundedTriangleGeometry();
    expect(geometry.type).toBe("ShapeGeometry");
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const depth = box.max.z - box.min.z;
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    geometry.dispose();
    // Planar in XY — zero Z extent, and the face is clearly triangular.
    expect(depth).toBeLessThan(1e-6);
    expect(height).toBeGreaterThan(width * 0.7);
    expect(height).toBeLessThan(width * 0.98);
  });

  it("faces +Z so the FrontSide fill is visible", () => {
    const geometry = makeRoundedTriangleGeometry();
    const nrm = geometry.getAttribute("normal");
    let facing = 0;
    for (let i = 0; i < nrm.count; i++) {
      if (nrm.getZ(i) > 0.5) facing++;
    }
    geometry.dispose();
    expect(facing).toBeGreaterThan(nrm.count * 0.9);
  });
});
