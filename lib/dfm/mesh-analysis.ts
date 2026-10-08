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
