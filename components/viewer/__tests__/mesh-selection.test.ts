import { describe, expect, it } from "vitest";
import {
  buildFaceAdjacency,
  selectSmoothRegion,
  TRIANGLE_CAP,
} from "../mesh-selection";

/**
 * Non-indexed cylinder tessellation (axis = +z), STL-style: 2N side triangles
 * first, then N top-cap + N bottom-cap fan triangles. With N=128 adjacent
 * side quads differ by 360/128 ≈ 2.8° — under the 5° smoothness bound, like a
 * real CAD tessellation — while side↔cap dihedral is 90° (a feature edge).
 */
function buildCylinder(N = 128, radius = 10, height = 20) {
  const pos: number[] = [];
  const ring = (i: number): [number, number] => {
    const a = ((i % N) * 2 * Math.PI) / N;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  };
  for (let i = 0; i < N; i++) {
    const [x0, y0] = ring(i);
    const [x1, y1] = ring(i + 1);
    pos.push(x0, y0, 0, x1, y1, 0, x1, y1, height);
    pos.push(x0, y0, 0, x1, y1, height, x0, y0, height);
  }
  for (let i = 0; i < N; i++) {
    const [x0, y0] = ring(i);
    const [x1, y1] = ring(i + 1);
    pos.push(0, 0, height, x0, y0, height, x1, y1, height);
  }
  for (let i = 0; i < N; i++) {
    const [x0, y0] = ring(i);
    const [x1, y1] = ring(i + 1);
    pos.push(0, 0, 0, x1, y1, 0, x0, y0, 0);
  }
  return { positions: new Float32Array(pos), sideTriCount: 2 * N };
}

/** Unit cube, 2 triangles per face (12 total), consistent winding per face. */
function buildCube() {
  const pos: number[] = [];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ) => {
    pos.push(...a, ...b, ...c);
    pos.push(...a, ...c, ...d);
  };
  quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]); // z = 0
  quad([0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]); // z = 1
  quad([0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]); // y = 0
  quad([0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]); // y = 1
  quad([0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]); // x = 0
  quad([1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]); // x = 1
  return new Float32Array(pos);
}

/** Flat z=0 plane of n×n quads: every triangle is coplanar and smooth. */
function buildPlaneGrid(n: number) {
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pos.push(i, j, 0, i + 1, j, 0, i + 1, j + 1, 0);
      pos.push(i, j, 0, i + 1, j + 1, 0, i, j + 1, 0);
    }
  }
  return new Float32Array(pos);
}

describe("buildFaceAdjacency", () => {
  it("welds duplicated vertices into shared-edge adjacency", () => {
    const { positions, sideTriCount } = buildCylinder(8);
    const adjacency = buildFaceAdjacency(positions);
    expect(adjacency.triCount).toBe(positions.length / 9);
    // A closed manifold: every triangle has exactly 3 edge neighbors.
    for (let t = 0; t < adjacency.triCount; t++) {
      expect(adjacency.adj[t]).toHaveLength(3);
      expect(adjacency.featurePair[t]).toHaveLength(3);
    }
    // Side↔cap pairs (90° dihedral) are flagged as feature edges; the
    // coplanar pair inside a side quad is not.
    const firstSide = 0;
    const featureNeighbors = adjacency.adj[firstSide].filter(
      (nb, i) => adjacency.featurePair[firstSide][i] && nb >= sideTriCount
    );
    expect(featureNeighbors.length).toBeGreaterThan(0);
    const quadMate = adjacency.adj[0].indexOf(1);
    expect(quadMate).toBeGreaterThanOrEqual(0);
    expect(adjacency.featurePair[0][quadMate]).toBe(false);
  });
});

describe("selectSmoothRegion", () => {
  it("selects the whole cylinder barrel from any side triangle, no caps", () => {
    const { positions, sideTriCount } = buildCylinder();
    const adjacency = buildFaceAdjacency(positions);
    for (const seed of [0, 1, 57, sideTriCount - 1]) {
      const region = selectSmoothRegion(adjacency, seed);
      expect(region.capped).toBe(false);
      expect(region.triangles).toHaveLength(sideTriCount);
      expect(region.triangles.every((t) => t < sideTriCount)).toBe(true);
    }
  });

  it("selects a cap as one face, stopping at the barrel", () => {
    const { positions, sideTriCount } = buildCylinder();
    const N = sideTriCount / 2;
    const adjacency = buildFaceAdjacency(positions);
    const region = selectSmoothRegion(adjacency, sideTriCount); // top cap fan
    expect(region.triangles).toHaveLength(N);
    expect(
      region.triangles.every(
        (t) => t >= sideTriCount && t < sideTriCount + N
      )
    ).toBe(true);
  });

  it("selects exactly one cube face (stops at 90° feature edges)", () => {
    const adjacency = buildFaceAdjacency(buildCube());
    for (let face = 0; face < 6; face++) {
      const region = selectSmoothRegion(adjacency, face * 2);
      expect(region.triangles.toSorted((a, b) => a - b)).toEqual([
        face * 2,
        face * 2 + 1,
      ]);
    }
  });

  it("bounds the region at the triangle cap instead of hanging", () => {
    // 20×20 quads = 800 coplanar triangles, all smooth-connected.
    const adjacency = buildFaceAdjacency(buildPlaneGrid(20));
    expect(adjacency.triCount).toBe(800);
    const cap = 100;
    const region = selectSmoothRegion(adjacency, 0, cap);
    expect(region.capped).toBe(true);
    expect(region.triangles.length).toBeLessThanOrEqual(cap);
    expect(region.triangles.length).toBeGreaterThan(0);
    // Default cap is the documented runaway guard.
    expect(TRIANGLE_CAP).toBe(200_000);
    // An uncapped run on the same mesh grabs the whole plane.
    const full = selectSmoothRegion(adjacency, 0);
    expect(full.capped).toBe(false);
    expect(full.triangles).toHaveLength(800);
  });
});
