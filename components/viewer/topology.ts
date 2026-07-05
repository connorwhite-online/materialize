/**
 * B-rep topology sidecar consumption (MTR-174 / docs/text-to-cad/01 Phase 2).
 *
 * The CAD sidecar (`cad-runner/app.py:_export_topology`) can emit, alongside
 * the STL, a per-face tessellation manifest with real CAD identity:
 *
 *   { faces: [{ id, surface, params, triRange:[start,end] }],
 *     edges: [{ id, curve, polyline:[[x,y,z],…], faceIds:[…] }] }
 *
 * The exported STL's triangle order comes from the SAME per-face tessellation,
 * so `triRange` indexes the STL triangle list directly: a raycast hit gives a
 * triangle index → binary-search the ranges → the exact CAD face. Edges carry
 * their real B-rep polylines, so smooth-tangent edges (fillet boundaries, loft
 * seams) that `EdgesGeometry`'s dihedral threshold can never emit become
 * selectable.
 *
 * Pure parsing/geometry — no THREE imports — so it's cheap to unit-test.
 *
 * NOTE(MTR-174): the *persistence* of this sidecar (an R2 key on
 * `cadGenerations.topoStorageKey` + a signed URL to serve it) is being added
 * by the parallel cad-artifacts PR. Until a per-asset topology URL is
 * threaded through, `ModelViewer` receives no `topoUrl` and every part falls
 * back to the mesh flood-fill / feature-edge path — so this code is inert but
 * correct against the sidecar's emitted shape.
 */

export interface TopoFace {
  /** Stable-per-generation face id (index into the shape's face map). */
  id: number;
  /** OCC surface class: plane | cylinder | cone | sphere | torus | bspline… */
  surface: string;
  /**
   * Advisory surface parameters — only plane ({origin, normal}) and cylinder
   * ({origin, axis, radius}) are populated by the sidecar today; others null.
   */
  params: Record<string, unknown> | null;
  /** [startTri, endTri) into the STL triangle list (end exclusive). */
  triRange: [number, number];
}

export interface TopoEdge {
  id: number;
  /** OCC curve class: line | circle | ellipse | bspline… */
  curve: string;
  /** Sampled world-space (mm) polyline of the edge. */
  polyline: [number, number, number][];
  /** Ids of the faces this edge bounds. */
  faceIds: number[];
}

export interface CadTopology {
  faces: TopoFace[];
  edges: TopoEdge[];
}

function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Validate + normalize a parsed topology JSON. Returns null on anything that
 * isn't a usable manifest (so callers fail open to the mesh path). Faces are
 * sorted by `triRange` start so `faceForTriangle` can binary-search.
 */
export function parseTopology(json: unknown): CadTopology | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as { faces?: unknown; edges?: unknown };
  if (!Array.isArray(obj.faces)) return null;

  const faces: TopoFace[] = [];
  for (const raw of obj.faces) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const range = f.triRange;
    if (
      typeof f.id !== "number" ||
      typeof f.surface !== "string" ||
      !Array.isArray(range) ||
      range.length !== 2 ||
      typeof range[0] !== "number" ||
      typeof range[1] !== "number"
    ) {
      continue;
    }
    faces.push({
      id: f.id,
      surface: f.surface,
      params:
        f.params && typeof f.params === "object"
          ? (f.params as Record<string, unknown>)
          : null,
      triRange: [range[0], range[1]],
    });
  }
  if (faces.length === 0) return null;
  faces.sort((a, b) => a.triRange[0] - b.triRange[0]);

  const edges: TopoEdge[] = [];
  if (Array.isArray(obj.edges)) {
    for (const raw of obj.edges) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      if (
        typeof e.id !== "number" ||
        typeof e.curve !== "string" ||
        !Array.isArray(e.polyline)
      ) {
        continue;
      }
      const polyline = e.polyline.filter(isVec3) as [number, number, number][];
      if (polyline.length < 2) continue;
      const faceIds = Array.isArray(e.faceIds)
        ? (e.faceIds.filter((n) => typeof n === "number") as number[])
        : [];
      edges.push({ id: e.id, curve: e.curve, polyline, faceIds });
    }
  }

  return { faces, edges };
}

/**
 * The CAD face containing a given STL triangle index, via binary search over
 * the (sorted, contiguous) `triRange`s. O(log n) per pick; no threshold tuning.
 */
export function faceForTriangle(
  faces: TopoFace[],
  triIndex: number
): TopoFace | null {
  let lo = 0;
  let hi = faces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = faces[mid].triRange;
    if (triIndex < start) hi = mid - 1;
    else if (triIndex >= end) lo = mid + 1;
    else return faces[mid];
  }
  return null;
}

/** Round to at most `dp` decimals, dropping a trailing ".0". */
function num(n: number, dp = 2): string {
  return Number(n.toFixed(dp)).toString();
}

/** Nearest principal axis label for a direction vector, else its components. */
function axisLabel(v: [number, number, number]): string {
  const abs = v.map(Math.abs);
  const max = Math.max(...abs);
  if (max === 0) return "—";
  const dom = abs.indexOf(max);
  // A clearly dominant axis (others < 15% of it) → name it.
  if (abs.every((a, i) => i === dom || a < max * 0.15)) {
    return ["X", "Y", "Z"][dom] + (v[dom] < 0 ? "−" : "");
  }
  return `(${v.map((n) => num(n, 2)).join(", ")})`;
}

/**
 * A short semantic handle for a face — the payload upgrade that lets the
 * revision model map a pick back to a line of parametric source far more
 * reliably than bare coordinates: `cylinder r=2.7, axis Z`.
 */
export function describeFace(face: TopoFace): string {
  const p = face.params ?? {};
  if (face.surface === "cylinder") {
    const r = typeof p.radius === "number" ? `r=${num(p.radius)}` : null;
    const axis = isVec3(p.axis) ? `axis ${axisLabel(p.axis)}` : null;
    return ["cylinder", r, axis].filter(Boolean).join(", ");
  }
  if (face.surface === "plane") {
    const n = isVec3(p.normal) ? `normal ${axisLabel(p.normal)}` : null;
    return ["planar face", n].filter(Boolean).join(", ");
  }
  return `${face.surface} face`;
}

/** Polyline length (mm) of an edge. */
export function edgeLength(edge: TopoEdge): number {
  let len = 0;
  for (let i = 1; i < edge.polyline.length; i++) {
    const a = edge.polyline[i - 1];
    const b = edge.polyline[i];
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

/** A short semantic handle for an edge: `circular edge, length 17.0 mm`. */
export function describeEdge(edge: TopoEdge): string {
  const kind =
    edge.curve === "circle"
      ? "circular edge"
      : edge.curve === "line"
        ? "straight edge"
        : `${edge.curve} edge`;
  return `${kind}, length ${num(edgeLength(edge), 1)} mm`;
}
