/**
 * Composite eval scoring (MTR-228) — the cadbench.ai pattern: one headline
 * number per case that is the HARMONIC MEAN of a geometry axis and a spec
 * axis, with a hard zero-gate on either axis. Harmonic (not arithmetic) on
 * purpose: a case cannot buy back a failing axis with a strong one — "pretty
 * blob, wrong recipe" and "right dims, opaque mesh" both land at 0. This is
 * the trustworthy-over-plausible thesis (docs/text-to-cad/README.md) turned
 * into arithmetic.
 *
 * Axis definitions (both 0..1):
 *
 * - GEOMETRY axis — validity-gated dimensional accuracy. 0 unless the run is
 *   a real printable solid (compiled + isSolid + isWatertight + isManifold —
 *   i.e. `gradeRun(run).pass` with no expected dims). When valid, the axis is
 *   the dimension-accuracy fraction passed/ran over checks that actually RAN
 *   (the MTR-197/199 honesty rail: declared-but-not-run targets never count
 *   either way). When a valid run had NO dim targets that ran, the axis is 1 —
 *   geometry-only cases (no numeric callouts) are not penalized for having
 *   nothing to measure.
 *
 * - SPEC axis — spec consistency: the fraction of (ran dimension targets +
 *   judged negative checks) satisfied. A negative check is satisfied when the
 *   forbidden property is ABSENT. When a case has neither (no dim targets ran,
 *   no negative checks judged), the axis is 1 — there is no spec to violate.
 *
 * - EDITABILITY gate — for cases whose tier expects a parametric B-rep
 *   (every tier except `implicit` / `implicit-composite`, which are mesh-mode
 *   by design: trimesh via marching cubes, no STEP — see the glossary in
 *   docs/text-to-cad/README.md), a run that did not deliver a real B-rep
 *   scores composite 0 regardless of geometry. The signal is the sidecar's
 *   `remeshed` flag (top-level, or on any part of an assembly): the harness's
 *   last-attempt voxel-remesh escape produces a watertight mesh that LOOKS
 *   valid but is an opaque approximation — not editable, not STEP-exportable.
 *   Sub-metrics (validity, dims, aesthetic, neg-clean) still report normally;
 *   only the composite is zeroed.
 *
 * Pure — no server-only imports, unit-testable, safe for the standalone
 * eval runner.
 */
import type { CadRunResult } from "../../lib/cad/types";
import type { EvalTier } from "./cases";

/** Mesh-mode tiers: an implicit body is the DELIVERABLE, not a remesh escape. */
const MESH_MODE_TIERS: readonly EvalTier[] = ["implicit", "implicit-composite"];

/** Does this tier expect a parametric B-rep artifact from the run? */
export function isBrepExpectedTier(tier: EvalTier): boolean {
  return !MESH_MODE_TIERS.includes(tier);
}

/**
 * Did the run deliver a real B-rep (vs the voxel-remesh escape)? True only
 * when neither the run nor any assembly part was flagged `remeshed`.
 */
export function runDeliveredBrep(run: CadRunResult): boolean {
  if (run.remeshed) return false;
  return !(run.parts ?? []).some((p) => p.remeshed);
}

/** The signals a case's composite is computed from — all deterministic. */
export interface CompositeSignals {
  /** compiled + isSolid + isWatertight + isManifold (gradeRun(run).pass). */
  valid: boolean;
  /** Dimension checks that RAN (honesty rail) and how many passed. */
  dimsRan: number;
  dimsPassed: number;
  /** Judged negative checks and how many were clean (property absent). */
  negTotal: number;
  negClean: number;
  /** The case's tier expects a parametric B-rep artifact. */
  brepExpected: boolean;
  /** The run delivered a real B-rep (not remeshed). */
  brepDelivered: boolean;
}

/**
 * Zero-gated harmonic mean of the two axes: 0 when EITHER axis is 0, else
 * 2gs/(g+s). Inputs are clamped to [0, 1].
 */
export function compositeScore({
  geometry,
  spec,
}: {
  geometry: number;
  spec: number;
}): number {
  const g = Math.min(1, Math.max(0, geometry));
  const s = Math.min(1, Math.max(0, spec));
  if (g === 0 || s === 0) return 0;
  return (2 * g * s) / (g + s);
}

/** Geometry axis: validity-gated dim accuracy (see header). */
export function geometryAxis(s: CompositeSignals): number {
  if (!s.valid) return 0;
  return s.dimsRan > 0 ? s.dimsPassed / s.dimsRan : 1;
}

/** Spec axis: fraction of (ran dims + judged negative checks) satisfied. */
export function specAxis(s: CompositeSignals): number {
  const total = s.dimsRan + s.negTotal;
  if (total === 0) return 1;
  return (s.dimsPassed + s.negClean) / total;
}

/** Editability gate: B-rep expected but not delivered → composite is 0. */
export function isEditabilityGated(s: CompositeSignals): boolean {
  return s.brepExpected && !s.brepDelivered;
}

/** The per-case composite: editability gate, then zero-gated harmonic mean. */
export function caseComposite(s: CompositeSignals): number {
  if (isEditabilityGated(s)) return 0;
  return compositeScore({ geometry: geometryAxis(s), spec: specAxis(s) });
}

/** "0.86"-style rendering, stable across the scorecard. */
export function formatComposite(x: number): string {
  return x.toFixed(2);
}
