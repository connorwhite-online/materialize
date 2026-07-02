/**
 * Pure mesh-selection logic for the annotation tool's face picking. No
 * three.js imports — operates on plain position arrays so the weld/adjacency/
 * flood-fill behavior is unit-testable without a renderer. The three.js glue
 * (geometry access, userData caching, PickResult construction) stays in
 * model-viewer.tsx.
 */

/**
 * Neighbor-to-neighbor smoothness bound: the fill may step to an adjacent
 * triangle only if their normals differ by less than this. Neighbor-relative
 * (not seed-relative) so a continuously curved surface — where adjacent
 * tessellation triangles differ by only a degree or two — is walked in full.
 */
export const SMOOTH_ANGLE_DEG = 5;

/**
 * Dihedral angle above which a shared edge is a feature edge and the fill
 * never crosses it. Matches the `EdgesGeometry(geom, 25)` threshold used for
 * edge picking, so the face fill stops exactly where visible edges render.
 */
export const FEATURE_ANGLE_DEG = 25;

/** Runaway guard for noisy generative meshes: max triangles in one region. */
export const TRIANGLE_CAP = 200_000;

export interface FaceAdjacency {
  triCount: number;
  /** Per-triangle unit normal, flat xyz (length triCount * 3). */
  normals: Float32Array;
  /** Per-triangle edge-adjacent triangle indices. */
  adj: number[][];
  /**
   * Parallel to `adj`: true when the shared edge between the pair is a
   * feature edge (normal dot < cos(FEATURE_ANGLE_DEG)).
   */
  featurePair: boolean[][];
}

export interface SmoothRegion {
  /** Triangle indices reachable from the seed (always includes the seed). */
  triangles: number[];
  /** True when growth stopped at the triangle cap rather than a boundary. */
  capped: boolean;
}

/**
 * Build per-triangle normals + edge adjacency + per-pair feature-edge bits.
 * STL is non-indexed with float-noisy duplicate verts, so we weld by a
 * quantized position key before deriving shared-edge neighbors.
 *
 * @param positions flat xyz vertex positions (3 verts per triangle when
 *   `index` is absent)
 * @param index optional triangle index into `positions`
 */
export function buildFaceAdjacency(
  positions: ArrayLike<number>,
  index?: ArrayLike<number> | null
): FaceAdjacency {
  const triCount = Math.floor((index ? index.length : positions.length / 3) / 3);
  const vi = (i: number) => (index ? index[i] : i);

  // Quantization step scaled to the model so the weld tolerates float noise
  // without merging genuinely distinct vertices.
  let min = Infinity;
  let max = -Infinity;
  let sizeMax = 0;
  for (let axis = 0; axis < 3; axis++) {
    min = Infinity;
    max = -Infinity;
    for (let i = axis; i < positions.length; i += 3) {
      const p = positions[i];
      if (p < min) min = p;
      if (p > max) max = p;
    }
    if (max - min > sizeMax) sizeMax = max - min;
  }
  const q = (sizeMax || 1) * 1e-5;

  const vid = new Map<string, number>();
  const canon = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const p = vi(t * 3 + k) * 3;
      const key = `${Math.round(positions[p] / q)},${Math.round(
        positions[p + 1] / q
      )},${Math.round(positions[p + 2] / q)}`;
      let id = vid.get(key);
      if (id === undefined) {
        id = vid.size;
        vid.set(key, id);
      }
      canon[t * 3 + k] = id;
    }
  }

  const normals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const pa = vi(t * 3) * 3;
    const pb = vi(t * 3 + 1) * 3;
    const pc = vi(t * 3 + 2) * 3;
    const abx = positions[pb] - positions[pa];
    const aby = positions[pb + 1] - positions[pa + 1];
    const abz = positions[pb + 2] - positions[pa + 2];
    const acx = positions[pc] - positions[pa];
    const acy = positions[pc + 1] - positions[pa + 1];
    const acz = positions[pc + 2] - positions[pa + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      normals[t * 3] = nx / len;
      normals[t * 3 + 1] = ny / len;
      normals[t * 3 + 2] = nz / len;
    }
    // Degenerate (zero-area) triangles keep a zero normal: every dot test
    // against them fails, so they read as feature-bounded and never spread.
  }

  const edgeMap = new Map<string, number[]>();
  const eKey = (x: number, y: number) => (x < y ? `${x}_${y}` : `${y}_${x}`);
  for (let t = 0; t < triCount; t++) {
    const c0 = canon[t * 3];
    const c1 = canon[t * 3 + 1];
    const c2 = canon[t * 3 + 2];
    for (const [x, y] of [
      [c0, c1],
      [c1, c2],
      [c2, c0],
    ]) {
      const k = eKey(x, y);
      const arr = edgeMap.get(k);
      if (arr) arr.push(t);
      else edgeMap.set(k, [t]);
    }
  }

  const COS_FEATURE = Math.cos((FEATURE_ANGLE_DEG * Math.PI) / 180);
  const adj: number[][] = Array.from({ length: triCount }, () => []);
  const featurePair: boolean[][] = Array.from({ length: triCount }, () => []);
  for (const arr of edgeMap.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const dot =
          normals[a * 3] * normals[b * 3] +
          normals[a * 3 + 1] * normals[b * 3 + 1] +
          normals[a * 3 + 2] * normals[b * 3 + 2];
        const feature = dot < COS_FEATURE;
        adj[a].push(b);
        featurePair[a].push(feature);
        adj[b].push(a);
        featurePair[b].push(feature);
      }
    }
  }

  return { triCount, normals, adj, featurePair };
}

/**
 * Flood-fill the "optical face" containing the seed triangle: the connected
 * set reachable without crossing a feature edge or a neighbor-to-neighbor
 * normal jump > SMOOTH_ANGLE_DEG. On a cylinder this walks the whole barrel
 * and stops at the end-cap feature edges; on a flat face it stops at the
 * first chamfer/corner. `cap` bounds region size (runaway guard).
 */
export function selectSmoothRegion(
  adjacency: FaceAdjacency,
  seedTri: number,
  cap: number = TRIANGLE_CAP
): SmoothRegion {
  const { triCount, normals, adj, featurePair } = adjacency;
  const COS_SMOOTH = Math.cos((SMOOTH_ANGLE_DEG * Math.PI) / 180);

  const seen = new Uint8Array(triCount);
  seen[seedTri] = 1;
  let seenCount = 1;
  const stack = [seedTri];
  const triangles: number[] = [];
  let capped = false;
  while (stack.length) {
    const t = stack.pop()!;
    triangles.push(t);
    const tnx = normals[t * 3];
    const tny = normals[t * 3 + 1];
    const tnz = normals[t * 3 + 2];
    const neighbors = adj[t];
    const features = featurePair[t];
    for (let i = 0; i < neighbors.length; i++) {
      const nb = neighbors[i];
      if (seen[nb] || features[i]) continue;
      const dot =
        tnx * normals[nb * 3] +
        tny * normals[nb * 3 + 1] +
        tnz * normals[nb * 3 + 2];
      if (dot < COS_SMOOTH) continue;
      if (seenCount >= cap) {
        capped = true;
        continue;
      }
      seen[nb] = 1;
      seenCount++;
      stack.push(nb);
    }
  }
  return { triangles, capped };
}
