import { describe, it, expect } from "vitest";
import {
  ROUNDED_TRIANGLE_CORNER_RADIUS,
  ROUNDED_TRIANGLE_SIDE,
  roundedTriangleShape,
  makeRoundedTriangleGeometry,
} from "../rounded-triangle";

describe("roundedTriangleShape", () => {
  it("keeps the fillet small so the sides stay long and straight", () => {
    expect(ROUNDED_TRIANGLE_CORNER_RADIUS / ROUNDED_TRIANGLE_SIDE).toBeLessThan(
      0.12
    );
    expect(ROUNDED_TRIANGLE_CORNER_RADIUS / ROUNDED_TRIANGLE_SIDE).toBeGreaterThan(
      0.05
    );
  });

  it("is a closed triangle with filleted corners, not a sharp yield sign", () => {
    const shape = roundedTriangleShape();
    const points = shape.getPoints(24);
    expect(points.length).toBeGreaterThan(20);

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // Equilateral height/width is √3/2 ≈ 0.866. A small fillet stays close.
    expect(height).toBeGreaterThan(width * 0.8);
    expect(height).toBeLessThan(width * 0.95);

    // Sharp equilateral would put a vertex at the exact top. A fillet
    // flattens that into an arc, so several points share the peak band.
    const peak = Math.max(...ys);
    const nearPeak = points.filter((p) => peak - p.y < 0.04);
    expect(nearPeak.length).toBeGreaterThan(2);

    // Short outward fillet: the tip drops by about the corner radius,
    // not by a full-circle lobe into the interior.
    const sharpPeak = (2 * ((ROUNDED_TRIANGLE_SIDE * Math.sqrt(3)) / 2)) / 3;
    expect(sharpPeak - peak).toBeGreaterThan(ROUNDED_TRIANGLE_CORNER_RADIUS * 0.7);
    expect(sharpPeak - peak).toBeLessThan(ROUNDED_TRIANGLE_CORNER_RADIUS * 1.3);
  });

  it("stays inside the sharp equilateral — fillets cut corners, they don't balloon", () => {
    const side = ROUNDED_TRIANGLE_SIDE;
    const h = (side * Math.sqrt(3)) / 2;
    // Same winding as the shape (top → BR → BL, clockwise). Interior
    // is to the right of each directed edge, so the cross is ≤ 0.
    const a = { x: 0, y: (2 * h) / 3 };
    const b = { x: side / 2, y: -h / 3 };
    const c = { x: -side / 2, y: -h / 3 };
    const sign = (
      p: { x: number; y: number },
      q: { x: number; y: number },
      r: { x: number; y: number }
    ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

    const points = roundedTriangleShape().getPoints(32);
    for (const p of points) {
      expect(sign(a, b, p)).toBeLessThan(1e-4);
      expect(sign(b, c, p)).toBeLessThan(1e-4);
      expect(sign(c, a, p)).toBeLessThan(1e-4);
    }
  });

  it("has a straight bottom edge between the two base fillets", () => {
    const side = ROUNDED_TRIANGLE_SIDE;
    const h = (side * Math.sqrt(3)) / 2;
    const bottomY = -h / 3;
    const points = roundedTriangleShape().getPoints(32);
    const onBottom = points.filter((p) => Math.abs(p.y - bottomY) < 0.02);
    expect(onBottom.length).toBeGreaterThanOrEqual(2);
    const xs = onBottom.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(-0.2);
    expect(xs[xs.length - 1]).toBeGreaterThan(0.2);
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
