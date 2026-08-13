/**
 * Feature-level dimension resolution against the B-rep topology manifest
 * (MTR-197 phase 2 / dimension annotations).
 *
 * `diameter` and `distance` targets used to be accepted but never evaluated
 * (`ran: false` honesty rail) because they need per-face identity. The
 * topology sidecar (MTR-174, `cad-runner/app.py:_export_topology`) ships
 * exactly that: cylinder faces carry `{origin, axis, radius}` and plane faces
 * `{origin, normal}`, all in the model's own mm coordinates. This module
 * matches a target against those faces DETERMINISTICALLY — the model never
 * freehands a measured value or an anchor, so an annotation can't point at
 * geometry that doesn't exist.
 *
 * Shared by design (pure, no `server-only`):
 *  - `checkDimensionTargets` (lib/cad/dimension-check.ts) uses the measured
 *    value to evaluate the target and stamps the matched `faceIds` onto the
 *    result, which is persisted per generation.
 *  - The viewer's dimension layer maps those `faceIds` back onto the mesh via
 *    the manifest's `triRange`s (components/viewer/topology.ts) to place the
 *    callout in 3D.
 *
 * Matching is by value proximity, which has a known circularity: we find the
 * geometry CLOSEST to spec, so a pass means "a feature of this size exists",
 * not "the feature the label names is this size". The result `note` states
 * what was matched so the claim stays honest. A part whose topology carries
 * no candidate feature at all is a real, ran-and-failed verdict — "no
 * cylindrical feature found" is precisely the failure the contract exists to
 * catch.
 */

import type { CadTopology, TopoFace } from "@/components/viewer/topology";

type Vec3 = [number, number, number];

/** A resolved feature-level measurement for one target. */
export interface FeatureDimensionMatch {
  /** Measured value (mm): a diameter (2r) or a plane-pair distance. */
  measured: number;
  /**
   * Topology face ids that anchor this measurement: every cylindrical face at
   * the matched radius (a "4× M3" pattern anchors all four), or the two
   * parallel plane faces whose separation was measured.
   */
  faceIds: number[];
  /** What was matched, for the check note ("4 cylindrical faces ⌀6.00"). */
  note: string;
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * How far from spec a best candidate may be and still count as "this is the
 * feature the target means, it's just out of tolerance" (a ran-and-FAILED
 * verdict with a measured value). Beyond it, the match is refused: reporting
 * "your 8 mm hole measures 22 mm" when the nearest cylinder is a 22 mm boss
 * would be noise, so the verdict becomes "no matching feature" instead.
 */
export function captureBandMm(value: number): number {
  return Math.max(3, Math.abs(value) * 0.25);
}

/** Cylindrical faces grouped by diameter (2 dp), largest group first. */
function cylinderGroups(
  topo: CadTopology
): { diameter: number; faceIds: number[] }[] {
  const byDiameter = new Map<string, { diameter: number; faceIds: number[] }>();
  for (const face of topo.faces) {
    if (face.surface !== "cylinder") continue;
    const r = face.params?.radius;
    if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) continue;
    const d = 2 * r;
    const key = d.toFixed(2);
    const group = byDiameter.get(key) ?? { diameter: d, faceIds: [] };
    group.faceIds.push(face.id);
    byDiameter.set(key, group);
  }
  return [...byDiameter.values()];
}

/**
 * Resolve a `diameter` target: the cylindrical-face diameter group closest to
 * the spec value, within the capture band. `null` when the topology carries
 * no cylindrical face near the spec — callers report that as a ran-and-failed
 * "no matching feature" verdict (see `checkDimensionTargets`), never as a
 * silent pass.
 */
export function resolveDiameter(
  topo: CadTopology,
  valueMm: number
): FeatureDimensionMatch | null {
  let best: { diameter: number; faceIds: number[] } | null = null;
  for (const group of cylinderGroups(topo)) {
    if (!best || Math.abs(group.diameter - valueMm) < Math.abs(best.diameter - valueMm)) {
      best = group;
    }
  }
  if (!best || Math.abs(best.diameter - valueMm) > captureBandMm(valueMm)) {
    return null;
  }
  const n = best.faceIds.length;
  return {
    measured: best.diameter,
    faceIds: best.faceIds,
    note: `matched ${n} cylindrical face${n === 1 ? "" : "s"} at ⌀${best.diameter.toFixed(2)} mm`,
  };
}

/** A deduplicated plane: canonical unit normal + signed offset + member faces. */
interface PlaneEntry {
  normal: Vec3;
  /** Signed distance of the plane from the origin along `normal`. */
  offset: number;
  faceIds: number[];
}

/** Two unit vectors within ~2.5° of (anti)parallel. */
function sameDirection(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 0.999;
}

/** Planar faces collapsed into unique geometric planes (0.05 mm offset bins). */
function uniquePlanes(topo: CadTopology): PlaneEntry[] {
  const planes: PlaneEntry[] = [];
  for (const face of topo.faces) {
    if (face.surface !== "plane") continue;
    const rawNormal = face.params?.normal;
    const origin = face.params?.origin;
    if (!isVec3(rawNormal) || !isVec3(origin)) continue;
    let normal = normalize(rawNormal);
    if (!normal) continue;
    let offset =
      origin[0] * normal[0] + origin[1] * normal[1] + origin[2] * normal[2];
    // Canonical orientation (first nonzero component positive) so a face and
    // its opposite-normal twin on the SAME geometric plane collapse together.
    const dominant = normal.find((c) => Math.abs(c) > 1e-9) ?? 0;
    if (dominant < 0) {
      normal = [-normal[0], -normal[1], -normal[2]];
      offset = -offset;
    }
    const existing = planes.find(
      (p) => sameDirection(p.normal, normal!) && Math.abs(p.offset - offset) < 0.05
    );
    if (existing) existing.faceIds.push(face.id);
    else planes.push({ normal, offset, faceIds: [face.id] });
  }
  return planes;
}

/**
 * Resolve a `distance` target: the parallel plane pair whose separation is
 * closest to the spec value, within the capture band. Face ids of BOTH planes
 * anchor the annotation. `null` when no parallel pair lands near spec.
 */
export function resolveDistance(
  topo: CadTopology,
  valueMm: number
): FeatureDimensionMatch | null {
  const planes = uniquePlanes(topo);
  let best: { separation: number; a: PlaneEntry; b: PlaneEntry } | null = null;
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (!sameDirection(planes[i].normal, planes[j].normal)) continue;
      const separation = Math.abs(planes[i].offset - planes[j].offset);
      if (separation < 1e-6) continue;
      if (!best || Math.abs(separation - valueMm) < Math.abs(best.separation - valueMm)) {
        best = { separation, a: planes[i], b: planes[j] };
      }
    }
  }
  if (!best || Math.abs(best.separation - valueMm) > captureBandMm(valueMm)) {
    return null;
  }
  return {
    measured: best.separation,
    faceIds: [...best.a.faceIds, ...best.b.faceIds],
    note: `matched parallel faces ${best.separation.toFixed(2)} mm apart`,
  };
}

/**
 * Direction the matched feature runs along, for annotation placement: a
 * cylinder's axis, or a plane pair's shared normal. Null when unavailable.
 */
export function matchDirection(
  topo: CadTopology,
  faceIds: number[]
): Vec3 | null {
  const byId = new Map<number, TopoFace>(topo.faces.map((f) => [f.id, f]));
  for (const id of faceIds) {
    const face = byId.get(id);
    if (!face) continue;
    const axis = face.surface === "cylinder" ? face.params?.axis : face.params?.normal;
    if (isVec3(axis)) {
      const unit = normalize(axis);
      if (unit) return unit;
    }
  }
  return null;
}
