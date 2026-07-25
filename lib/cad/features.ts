/**
 * Construction-feature helpers for the B-rep feature-chip UX.
 *
 * Pure — safe to import from client or server. The sidecar emits a
 * `features[]` list (see CadFeature); we validate it, bind control keys to
 * top-level source parameter names for Reset/Update, and resolve face-id
 * sets into triangle ranges for viewer highlight.
 */

import { extractParams, substituteParams } from "@/components/cad/param-diff";
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
    // 1-based inclusive [start, end] statement span (MTR-225); dropped when
    // malformed so downstream span logic can trust it.
    let span: [number, number] | undefined;
    if (
      Array.isArray(f.span) &&
      f.span.length === 2 &&
      isFiniteNumber(f.span[0]) &&
      isFiniteNumber(f.span[1]) &&
      f.span[0] >= 1 &&
      f.span[1] >= f.span[0]
    ) {
      span = [Math.floor(f.span[0]), Math.floor(f.span[1])];
    }
    out.push({
      id: f.id,
      op: f.op as CadFeatureOp,
      label: f.label,
      params,
      ...(Object.keys(paramNames).length > 0 ? { paramNames } : {}),
      faceIds,
      ...(span ? { span } : {}),
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

// ---------------------------------------------------------------------------
// Statement-span editing (MTR-225)
// ---------------------------------------------------------------------------

/** The lines of a feature's statement span (1-based inclusive), or null. */
export function spanText(sourceCode: string, span: [number, number]): string | null {
  const lines = sourceCode.split("\n");
  const [start, end] = span;
  if (start < 1 || end > lines.length) return null;
  return lines.slice(start - 1, end).join("\n");
}

/** Standalone numeric-literal occurrences of `value` within `text`. */
function literalMatches(text: string, value: number): number {
  // Format the way Python repr's simple numbers ("2.4", "12", "-3"); a chip
  // param always originated as a literal or a name — names are handled by
  // paramNames, so here we only hunt literals.
  const lit = String(value);
  const escaped = lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not preceded/followed by identifier chars, '.', or digits — so 2.4
  // doesn't match inside 12.45, r2_4, or 2.45.
  const re = new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`, "g");
  return (text.match(re) ?? []).length;
}

/**
 * Control keys of a feature that are editable against this source: bound to
 * a top-level param name, OR appearing exactly once as a numeric literal
 * inside the feature's statement span. Ambiguity (two identical literals in
 * the span) keeps a key non-editable — the honesty invariant: never guess
 * which occurrence the user means.
 */
export function editableFeatureKeys(
  feature: CadFeature,
  sourceCode: string
): Set<string> {
  const out = new Set<string>();
  const names = feature.paramNames ?? {};
  const text = feature.span ? spanText(sourceCode, feature.span) : null;
  for (const [key, value] of Object.entries(feature.params)) {
    if (names[key]) {
      out.add(key);
      continue;
    }
    if (text !== null && literalMatches(text, value) === 1) out.add(key);
  }
  return out;
}

/**
 * Apply a feature-scoped draft to the source: name-bound keys rewrite their
 * top-level assignment (via param-diff's substitute), span-literal keys
 * rewrite the single matching literal inside the statement span. Returns
 * null when nothing could be applied. Pure; the server re-runs this against
 * its own copy of source + features, so a stale client can only ever change
 * numbers in verified positions — never inject text.
 */
export function substituteFeatureParams(
  sourceCode: string,
  feature: CadFeature,
  draft: Record<string, number>
): { source: string; applied: string[] } | null {
  const names = feature.paramNames ?? {};
  const topLevel: Record<string, number> = {};
  const spanEdits: [string, number][] = [];
  const editable = editableFeatureKeys(feature, sourceCode);

  for (const [key, value] of Object.entries(draft)) {
    if (!Number.isFinite(value) || !editable.has(key)) continue;
    if (value === feature.params[key]) continue;
    if (names[key]) topLevel[names[key]] = value;
    else spanEdits.push([key, value]);
  }
  if (Object.keys(topLevel).length === 0 && spanEdits.length === 0) return null;

  let source = sourceCode;
  const applied: string[] = [];

  if (spanEdits.length > 0 && feature.span) {
    const lines = source.split("\n");
    const [start, end] = feature.span;
    let text = lines.slice(start - 1, end).join("\n");
    for (const [key, value] of spanEdits) {
      const old = feature.params[key];
      const escaped = String(old).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`);
      const next = text.replace(re, String(value));
      if (next !== text) {
        text = next;
        applied.push(key);
      }
    }
    source = [
      ...lines.slice(0, start - 1),
      ...text.split("\n"),
      ...lines.slice(end),
    ].join("\n");
  }

  if (Object.keys(topLevel).length > 0) {
    source = substituteParams(source, topLevel);
    applied.push(
      ...Object.keys(draft).filter((k) => names[k] && names[k] in topLevel)
    );
  }

  return applied.length > 0 ? { source, applied } : null;
}

/**
 * Splice replacement lines over a feature's statement span, preserving the
 * original first line's indentation when the replacement arrives unindented
 * (models often return dedented snippets). Used by the stmt-edit repair
 * path; the sidecar re-run is the correctness gate.
 */
export function spliceStatementSpan(
  sourceCode: string,
  span: [number, number],
  replacement: string
): string | null {
  const lines = sourceCode.split("\n");
  const [start, end] = span;
  if (start < 1 || end > lines.length) return null;
  const originalIndent = lines[start - 1].match(/^[ \t]*/)?.[0] ?? "";
  let repl = replacement.replace(/\s+$/, "");
  if (repl.trim().length === 0) return null;
  const replLines = repl.split("\n");
  const replIndent = replLines[0].match(/^[ \t]*/)?.[0] ?? "";
  if (originalIndent.length > 0 && replIndent.length === 0) {
    repl = replLines.map((l) => (l.trim() ? originalIndent + l : l)).join("\n");
  }
  return [
    ...lines.slice(0, start - 1),
    ...repl.split("\n"),
    ...lines.slice(end),
  ].join("\n");
}
