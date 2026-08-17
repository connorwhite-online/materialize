import { describe, it, expect } from "vitest";
import { OG_SIZE, stackGeometry, stackTileAngle } from "../render-card";
import { MAX_STACK_TILES } from "../project-card";

const DEG = Math.PI / 180;

/**
 * Width a fanned stack actually occupies, including the bounding-box
 * expansion rotation causes on the two outermost tiles: a side-T
 * square rotated by θ spans T·(cosθ + sinθ).
 */
function fannedWidth(count: number): number {
  const { tile, overlap } = stackGeometry(count);
  const laidOut = tile * count + overlap * (count - 1);
  const outerAngle = Math.abs(stackTileAngle(0, count)) * DEG;
  const expansion =
    tile * (Math.cos(outerAngle) + Math.sin(outerAngle)) - tile;
  return laidOut + expansion;
}

function fannedHeight(count: number): number {
  const { tile } = stackGeometry(count);
  const outerAngle = Math.abs(stackTileAngle(0, count)) * DEG;
  return tile * (Math.cos(outerAngle) + Math.sin(outerAngle));
}

describe("stack geometry", () => {
  it("keeps every supported stack inside the frame", () => {
    // The whole point of the stack is showing the bundled art, so the
    // outermost tiles must never be clipped by the card edge. A fixed
    // tile size overflowed at four tiles and up.
    for (let n = 1; n <= MAX_STACK_TILES; n++) {
      expect(fannedWidth(n), `width at ${n} tiles`).toBeLessThanOrEqual(
        OG_SIZE.width
      );
      expect(fannedHeight(n), `height at ${n} tiles`).toBeLessThanOrEqual(
        OG_SIZE.height
      );
    }
  });

  it("shrinks tiles as the count grows", () => {
    const sizes = [2, 3, 4, 5].map((n) => stackGeometry(n).tile);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
  });

  it("caps tile size so a small stack isn't grotesque", () => {
    expect(stackGeometry(1).tile).toBe(stackGeometry(2).tile);
    expect(stackGeometry(1).tile).toBeLessThanOrEqual(420);
  });

  it("overlaps tiles rather than spacing them apart", () => {
    for (let n = 2; n <= MAX_STACK_TILES; n++) {
      expect(stackGeometry(n).overlap).toBeLessThan(0);
    }
  });
});

describe("stackTileAngle", () => {
  it("fans symmetrically about the centre", () => {
    for (const n of [2, 3, 4, 5]) {
      const angles = Array.from({ length: n }, (_, i) => stackTileAngle(i, n));
      // Mirrored pairs sum to zero, so the fan reads centred.
      for (let i = 0; i < n; i++) {
        expect(angles[i] + angles[n - 1 - i]).toBeCloseTo(0, 6);
      }
      // Monotonic left-to-right — no tile tilts against its neighbours.
      for (let i = 1; i < n; i++) {
        expect(angles[i]).toBeGreaterThan(angles[i - 1]);
      }
    }
  });

  it("leaves a lone tile upright", () => {
    expect(stackTileAngle(0, 1)).toBe(0);
  });

  it("puts the outermost tiles at the full fan angle", () => {
    for (const n of [2, 3, 4, 5]) {
      expect(stackTileAngle(0, n)).toBeCloseTo(-9, 6);
      expect(stackTileAngle(n - 1, n)).toBeCloseTo(9, 6);
    }
  });

  it("keeps the middle tile of an odd stack upright", () => {
    expect(stackTileAngle(1, 3)).toBeCloseTo(0, 6);
    expect(stackTileAngle(2, 5)).toBeCloseTo(0, 6);
  });
});
