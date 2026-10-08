/**
 * Mesh facts for the agent-facing printability check. Pure: triangles in,
 * numbers out, no IO, so it runs under vitest without a database.
 *
 * This is a deliberately cheap first pass over the uploaded file, not the
 * CAD runner's ray-cast DFM (`cad-runner/dfm.py`). It answers "is this a
 * solid, how big is it, and is it plausibly thin" in a single linear scan.
 * The thin-wall figure in particular is an ESTIMATE (see `meanThicknessMm`),
 * and callers must label it as one.
 */

/** Above this we skip the edge/topology pass; the maps cost ~100 B/edge. */
export const MAX_TOPOLOGY_TRIANGLES = 800_000;

/** Vertices closer than this (mm) are the same vertex when matching edges. */
const WELD_MM = 1e-4;

export interface MeshAnalysis {
  triangleCount: number;
  /** Axis-aligned extents in mm. */
  bboxMm: { x: number; y: number; z: number };
  volumeMm3: number;
  surfaceAreaMm2: number;
  /** Signed volume was negative: triangle winding points inward. */
  invertedNormals: boolean;
  /** Triangles with (near) zero area. */
  degenerateTriangles: number;
  /**
   * Topology, or null when the mesh was too large to check
   * (`MAX_TOPOLOGY_TRIANGLES`).
   */
  topology: {
    /** Edges used by exactly one triangle: holes in the surface. */
    openEdges: number;
    /** Edges used by three or more triangles. */
    nonManifoldEdges: number;
    /** Connected pieces of the mesh. More than one means loose parts. */
    shells: number;
  } | null;
  /**
   * 2V/A. For a slab or thin shell of thickness t the volume is about
   * t * A / 2 (A counts both faces), so this recovers t. It overestimates
   * the thinnest spot on anything chunky and means nothing on a mesh with
   * holes (null then). A LOW value is a reliable warning; a high one
   * proves nothing, so callers must call it an estimate.
   */
  meanThicknessMm: number | null;
}

const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 } as const;

export function analyzeTriangles(
  triangles: Float64Array,
  unit: keyof typeof UNIT_TO_MM = "mm"
): MeshAnalysis {
  const k = UNIT_TO_MM[unit];
  const triCount = Math.floor(triangles.length / 9);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let vol6 = 0;
  let area = 0;
  let degenerate = 0;

  for (let i = 0; i < triCount * 9; i += 9) {
    const ax = triangles[i] * k, ay = triangles[i + 1] * k, az = triangles[i + 2] * k;
    const bx = triangles[i + 3] * k, by = triangles[i + 4] * k, bz = triangles[i + 5] * k;
    const cx = triangles[i + 6] * k, cy = triangles[i + 7] * k, cz = triangles[i + 8] * k;

    minX = Math.min(minX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz);
    maxX = Math.max(maxX, ax, bx, cx);
    maxY = Math.max(maxY, ay, by, cy);
    maxZ = Math.max(maxZ, az, bz, cz);

    vol6 +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const a = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (a < 1e-9) degenerate++;
    area += a;
  }

  const volumeMm3 = Math.abs(vol6) / 6;
  const topology =
    triCount > 0 && triCount <= MAX_TOPOLOGY_TRIANGLES
      ? analyzeTopology(triangles, triCount, k)
      : null;
  const watertight =
    topology !== null &&
    topology.openEdges === 0 &&
    topology.nonManifoldEdges === 0;

  return {
    triangleCount: triCount,
    bboxMm: {
      x: triCount ? maxX - minX : 0,
      y: triCount ? maxY - minY : 0,
      z: triCount ? maxZ - minZ : 0,
    },
    volumeMm3,
    surfaceAreaMm2: area,
    invertedNormals: vol6 < 0,
    degenerateTriangles: degenerate,
    topology,
    meanThicknessMm: watertight && area > 0 ? (2 * volumeMm3) / area : null,
  };
}

function analyzeTopology(
  triangles: Float64Array,
  triCount: number,
  k: number
): NonNullable<MeshAnalysis["topology"]> {
  const inv = 1 / WELD_MM;
  const vertexIds = new Map<string, number>();
  const idOf = (x: number, y: number, z: number) => {
    const key = `${Math.round(x * k * inv)},${Math.round(y * k * inv)},${Math.round(z * k * inv)}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexIds.size;
      vertexIds.set(key, id);
    }
    return id;
  };

  const tri = new Int32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    tri[t * 3] = idOf(triangles[o], triangles[o + 1], triangles[o + 2]);
    tri[t * 3 + 1] = idOf(triangles[o + 3], triangles[o + 4], triangles[o + 5]);
    tri[t * 3 + 2] = idOf(triangles[o + 6], triangles[o + 7], triangles[o + 8]);
  }

  // Shells: union vertices that share a triangle.
  const parent = new Int32Array(vertexIds.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Edge use counts, keyed by the two vertex ids in ascending order.
  const edges = new Map<number, number>();
  const n = vertexIds.size;
  const countEdge = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? a * n + b : b * n + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < triCount; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    countEdge(a, b);
    countEdge(b, c);
    countEdge(c, a);
    union(a, b);
    union(b, c);
  }

  let open = 0, nonManifold = 0;
  for (const c of edges.values()) {
    if (c === 1) open++;
    else if (c > 2) nonManifold++;
  }
  const roots = new Set<number>();
  for (let t = 0; t < triCount; t++) roots.add(find(tri[t * 3]));

  return { openEdges: open, nonManifoldEdges: nonManifold, shells: roots.size };
}

/**
 * Wall thickness MEASURED at sample points, not inferred from volume.
 *
 * Points are drawn over the surface (area-weighted, fixed seed so the same
 * file always gives the same answer), and from each one a ray goes inward
 * along the face normal to the first surface it meets: that distance is the
 * wall there. It is the method the CAD runner's DFM check uses
 * (`cad-runner/dfm.py`).
 *
 * It is sampled, so a feature thinner than the sample spacing can slip
 * through; `samples` says how many points were measured. It needs a closed
 * mesh with consistent winding, so it returns null when the mesh has holes,
 * is too heavy for the time budget, or no ray hit anything.
 */
export interface WallSample {
  samples: number;
  /** Thinnest single sample. Noisy: one sliver face can set it. */
  minMm: number;
  /** 5th percentile: the thin end, with sliver noise dropped. */
  thinMm: number;
  medianMm: number;
  /** All measured thicknesses, ascending, for per-material fractions. */
  sorted: Float32Array;
}

/** Ray-triangle tests allowed per call (rays x triangles). ~1.5s of JS. */
const RAY_BUDGET = 1.5e8;
const MAX_RAYS = 1500;
const MIN_RAYS = 150;

export function sampleWallThickness(
  triangles: Float64Array,
  unit: keyof typeof UNIT_TO_MM = "mm",
  invertedNormals = false
): WallSample | null {
  const n = Math.floor(triangles.length / 9);
  if (n === 0) return null;
  const rays = Math.min(MAX_RAYS, Math.floor(RAY_BUDGET / n));
  if (rays < MIN_RAYS) return null;

  const k = UNIT_TO_MM[unit];
  const t = new Float64Array(n * 9);
  for (let i = 0; i < t.length; i++) t[i] = triangles[i] * k;

  // Cumulative area for area-weighted picks.
  const cum = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
    const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    cum[i] = total;
  }
  if (total <= 0) return null;

  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const flip = invertedNormals ? -1 : 1;
  const out: number[] = [];
  for (let r = 0; r < rays; r++) {
    // Area-weighted triangle pick.
    const target = rand() * total;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const o = lo * 9;
    const ax = t[o], ay = t[o + 1], az = t[o + 2];
    const ux = t[o + 3] - ax, uy = t[o + 4] - ay, uz = t[o + 5] - az;
    const vx = t[o + 6] - ax, vy = t[o + 7] - ay, vz = t[o + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;
    nx = (nx / len) * flip; ny = (ny / len) * flip; nz = (nz / len) * flip;

    // Uniform point in the triangle.
    let a = rand(), b = rand();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const px = ax + a * ux + b * vx, py = ay + a * uy + b * vy, pz = az + a * uz + b * vz;

    // Inward ray, nudged off the surface so it doesn't hit its own face.
    const eps = 1e-3;
    const dx = -nx, dy = -ny, dz = -nz;
    const ox = px + dx * eps, oy = py + dy * eps, oz = pz + dz * eps;
    const hit = nearestHit(t, n, ox, oy, oz, dx, dy, dz);
    if (hit !== null) out.push(hit + eps);
  }
  if (out.length < MIN_RAYS / 2) return null;

  const sorted = Float32Array.from(out).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    samples: sorted.length,
    minMm: sorted[0],
    thinMm: at(0.05),
    medianMm: at(0.5),
    sorted,
  };
}

/** Moller-Trumbore against every triangle; nearest positive hit or null. */
function nearestHit(
  t: Float64Array,
  n: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number
): number | null {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ax = t[o], ay = t[o + 1], az = t[o + 2];
    const e1x = t[o + 3] - ax, e1y = t[o + 4] - ay, e1z = t[o + 5] - az;
    const e2x = t[o + 6] - ax, e2y = t[o + 7] - ay, e2z = t[o + 8] - az;
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = inv * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = inv * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;
    const d = inv * (e2x * qx + e2y * qy + e2z * qz);
    if (d > 1e-6 && d < best) best = d;
  }
  return best === Infinity ? null : best;
}
