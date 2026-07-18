/**
 * Construction-feature helpers for the B-rep feature-chip UX.
 *
 * Pure — safe to import from client or server. The sidecar emits a
 * `features[]` list (see CadFeature); we validate it, bind control keys to
 * top-level source parameter names for Reset/Update, and resolve face-id
 * sets into triangle ranges for viewer highlight.
 */

import { extractParams } from "@/components/cad/param-diff";
import type { CadFeature, CadFeatureOp } from "./types";
import type { CadTopology } from "@/components/viewer/topology";

const OPS = new Set<CadFeatureOp>([
  "extrude",
  "fillet",
  "chamfer",
  "loft",
  "revolve",
  "shell",
  "hole",
  "boolean",
  "other",
]);

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validate + normalize a sidecar/DB features payload. Returns [] on anything
 * unusable so the studio fails open (no chips) rather than crashing.
 */
export function parseFeatures(raw: unknown): CadFeature[] {
  if (!Array.isArray(raw)) return [];
  const out: CadFeature[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (typeof f.id !== "string" || !f.id) continue;
    if (typeof f.op !== "string" || !OPS.has(f.op as CadFeatureOp)) continue;
    if (typeof f.label !== "string") continue;
    const params: Record<string, number> = {};
    if (f.params && typeof f.params === "object") {
      for (const [k, v] of Object.entries(f.params as Record<string, unknown>)) {
        if (isFiniteNumber(v)) params[k] = v;
      }
    }
    const paramNames: Record<string, string> = {};
    if (f.paramNames && typeof f.paramNames === "object") {
      for (const [k, v] of Object.entries(
        f.paramNames as Record<string, unknown>
      )) {
        if (typeof v === "string" && v) paramNames[k] = v;
      }
    }
    const faceIds = Array.isArray(f.faceIds)
      ? f.faceIds.filter((n): n is number => typeof n === "number" && n >= 0)
      : [];
    out.push({
      id: f.id,
      op: f.op as CadFeatureOp,
      label: f.label,
      params,
      ...(Object.keys(paramNames).length > 0 ? { paramNames } : {}),
      faceIds,
    });
  }
  return out;
}

/**
 * Bind each feature's numeric params to uniquely-matching top-level source
 * assignments (`fillet_r = 2.4`). Ambiguous values (two params share 2.4) are
 * left unbound — Update stays disabled for that control rather than rewriting
 * the wrong name. Features that already carry paramNames keep them; only
 * missing bindings are filled.
 */
export function bindFeatureParamNames(
  features: CadFeature[],
  sourceCode: string
): CadFeature[] {
  const sourceParams = extractParams(sourceCode);
  // value → names that hold it (for uniqueness check)
  const byValue = new Map<number, string[]>();
  for (const [name, value] of Object.entries(sourceParams)) {
    const list = byValue.get(value) ?? [];
    list.push(name);
    byValue.set(value, list);
  }

  return features.map((f) => {
    const paramNames: Record<string, string> = { ...(f.paramNames ?? {}) };
    for (const [key, value] of Object.entries(f.params)) {
      if (paramNames[key]) continue;
      const names = byValue.get(value);
      if (names?.length === 1) paramNames[key] = names[0];
    }
    return Object.keys(paramNames).length > 0
      ? { ...f, paramNames }
      : { ...f, paramNames: undefined };
  });
}

/**
 * Triangle ranges ([start, end) into the STL triangle list) for a set of
 * topo face ids. Used by the viewer to build a FaceHighlight from a chip.
 */
export function triangleRangesForFaceIds(
  topo: CadTopology,
  faceIds: number[]
): [number, number][] {
  if (faceIds.length === 0) return [];
  const want = new Set(faceIds);
  const ranges: [number, number][] = [];
  for (const face of topo.faces) {
    if (!want.has(face.id)) continue;
    const [a, b] = face.triRange;
    if (b > a) ranges.push([a, b]);
  }
  return ranges;
}

/**
 * Build the flat position array a FaceHighlight expects from STL positions
 * + triangle ranges. Pure aside from reading the typed arrays — no THREE.
 */
export function positionsForTriangleRanges(
  position: ArrayLike<number>,
  index: ArrayLike<number> | null | undefined,
  triCount: number,
  ranges: [number, number][]
): number[] {
  const out: number[] = [];
  const vi = (i: number) => (index ? Number(index[i]) : i);
  for (const [start, end] of ranges) {
    const lo = Math.max(0, start);
    const hi = Math.min(triCount, end);
    for (let t = lo; t < hi; t++) {
      for (let k = 0; k < 3; k++) {
        const idx = vi(t * 3 + k) * 3;
        out.push(
          Number(position[idx]),
          Number(position[idx + 1]),
          Number(position[idx + 2])
        );
      }
    }
  }
  return out;
}

/** Map a feature's bound control values onto source param names for substitute. */
export function featureParamsToSourceParams(
  feature: CadFeature,
  draft: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  const names = feature.paramNames ?? {};
  for (const [key, value] of Object.entries(draft)) {
    const sourceName = names[key];
    if (sourceName && Number.isFinite(value)) out[sourceName] = value;
  }
  return out;
}
