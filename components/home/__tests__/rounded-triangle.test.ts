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
      0.18
    );
    expect(ROUNDED_TRIANGLE_CORNER_RADIUS / ROUNDED_TRIANGLE_SIDE).toBeLessThan(
      0.28
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
