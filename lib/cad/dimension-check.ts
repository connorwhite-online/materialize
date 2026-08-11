import { z } from "zod";

import { parseTopology } from "@/components/viewer/topology";
import {
  captureBandMm,
  resolveDiameter,
  resolveDistance,
} from "./feature-dimensions";
import type { CadRunResult } from "./types";

/**
 * The dimension contract (MTR-197). CAD Skills' single best methodology:
 * "convert every dimension callout into a named parameter and a validation
 * target", then verify each against the built geometry with deterministic
 * checks — not vibes (docs/text-to-cad/09 §4; their
 * `packages/cadpy/validators.py`).
 *
 * Pure (no `server-only`) on purpose: this is the SHARED check machinery. The
 * harness (lib/cad/harness.ts) feeds failures into the repair loop, the
 * agentic loop (lib/cad/agentic.ts) surfaces them as a tool result the model
 * must address, and the eval runner (scripts/evals) reuses the exact same code
 * path instead of a parallel expected-dims implementation (MTR-201).
 *
 * HONESTY RAIL (MTR-199 §5): a target is only ever reported as passed/failed
 * when the check actually RAN against real geometry. `diameter`/`distance`
 * targets are evaluated against the B-rep topology manifest (`run.topo`,
 * MTR-174 — see lib/cad/feature-dimensions.ts); when the run carries no
 * manifest (mesh-mode, old sidecar) they are returned `ran: false, ok: null`
 * — never silently counted as passing. No user-visible "dimensions verified"
 * claim may include a check that did not run.
 */

/**
 * A machine-checkable dimension callout.
 * - `bbox_span`  — overall extent along an axis (from the exported mesh bbox).
 * - `count`      — number of solids/parts (from the sidecar's bodyCount /
 *                  parts breakdown). `of` selects which population.
 * - `diameter` / `distance` — feature-level measures, evaluated against the
 *                  B-rep topology manifest (`run.topo`, MTR-174) by matching
 *                  cylindrical faces / parallel plane pairs near the spec
 *                  value (lib/cad/feature-dimensions.ts). Not-run when the
 *                  run carries no manifest (mesh-mode / old sidecar).
 * - `fit_cavity` / `fit_bosses` / `fit_cutout` — component-fit checks
 *                  (MTR-204), evaluated SIDECAR-side against the built mesh
 *                  (cad-runner/fit.py, requested via `checks.fit`). Auto-
 *                  emitted by `fitTargetsForBrief` for known components; each
 *                  carries an `id` matched against `run.checks.fit.results`.
 *                  When the sidecar returned no fit data (mock runner, old
 *                  sidecar, fit error) they report `ran: false` — honesty rail.
 */
export type DimensionTargetKind =
  | "bbox_span"
  | "diameter"
  | "distance"
  | "count"
  | "fit_cavity"
  | "fit_bosses"
  | "fit_cutout";
export type DimensionAxis = "x" | "y" | "z";

/** The fit target kinds — evaluated from sidecar `checks.fit` results. */
export const FIT_TARGET_KINDS = [
  "fit_cavity",
  "fit_bosses",
  "fit_cutout",
] as const;

export function isFitTargetKind(kind: DimensionTargetKind): boolean {
  return (FIT_TARGET_KINDS as readonly string[]).includes(kind);
}

export interface DimensionTarget {
  /** Human label, e.g. "overall height" or "through-hole diameter". */
  label: string;
  kind: DimensionTargetKind;
  /** Required for `bbox_span`; ignored otherwise. */
  axis?: DimensionAxis;
  /** For `count`: which population to count. Default "solid". */
  of?: "solid" | "part";
  /** Target value in mm (or a plain count for `kind: "count"`). */
  value: number;
  /** Half-width of the acceptance band. Absent → a computed default. */
  tolerance?: number;
  /**
   * The named source parameter responsible for this dimension (the contract's
   * "every callout becomes a named parameter"), e.g. "overall_height". Emitted
   * by the brief best-effort; the annotation layer shows it so a dimension on
   * screen maps back to the knob that controls it.
   */
  param?: string;
  /**
   * Stable id for sidecar-evaluated targets (fit_*): matched against
   * `run.checks.fit.results[].id`. Absent on locally-evaluated kinds.
   */
  id?: string;
  /**
   * Fit payload (MTR-204): the ComponentFitSpec on a `fit_cavity` target
   * (see lib/cad/knowledge/components.ts), or a `{ component }` reference on
   * its sibling boss/cutout targets. Opaque here on purpose — this module
   * ships it to the sidecar and matches results by id, nothing more.
   */
  fit?: unknown;
}

/** Zod schema for a brief-emitted target — permissive, best-effort like the brief. */
export const dimensionTargetSchema = z.looseObject({
  label: z.string(),
  kind: z.enum([
    "bbox_span",
    "diameter",
    "distance",
    "count",
    "fit_cavity",
    "fit_bosses",
    "fit_cutout",
  ]),
  axis: z.enum(["x", "y", "z"]).optional(),
  of: z.enum(["solid", "part"]).optional(),
  value: z.number(),
  tolerance: z.number().nonnegative().optional(),
  id: z.string().optional(),
  fit: z.unknown().optional(),
  param: z.string().optional(),
});

export interface DimensionCheckResult {
  target: DimensionTarget;
  /** Did we have the data to evaluate this target at all? */
  ran: boolean;
  /** Pass/fail when `ran`; null when not run (honesty rail). */
  ok: boolean | null;
  /** Measured value (mm or count) when `ran`. */
  got?: number;
  /** |got - value| when `ran`. */
  delta?: number;
  /** Effective tolerance used. */
  tolerance?: number;
  /** Why the check did not run, or extra context. */
  note?: string;
  /**
   * Topology face ids anchoring a feature-level measurement (`diameter`:
   * every cylindrical face at the matched radius; `distance`: both plane
   * faces). The viewer's dimension layer maps these onto the mesh via the
   * persisted topology manifest's `triRange`s to place the callout in 3D.
   * Absent on bbox/count/fit kinds and on not-run results.
   */
  faceIds?: number[];
}

/**
 * Default acceptance band when the target omits one: 2% of the target value,
 * floored at 0.5 mm — tight enough to catch order-of-magnitude and off-by-a-few
 * errors, loose enough not to fail on mesh-tessellation noise. Counts are exact.
 */
export function defaultTolerance(target: DimensionTarget): number {
  if (target.tolerance != null) return target.tolerance;
  // Counts and fit verdicts are exact — a boss pattern either matches or not.
  if (target.kind === "count" || isFitTargetKind(target.kind)) return 0;
  return Math.max(0.5, Math.abs(target.value) * 0.02);
}

/** How many independent solids the run produced (fused body count, or parts). */
function solidCount(run: CadRunResult): number | null {
  if (run.parts && run.parts.length > 0) return run.parts.length;
  const bc = run.validation?.bodyCount;
  return typeof bc === "number" ? bc : null;
}

/**
 * Evaluate dimension targets against a completed run. Deterministic — no model
 * call. Every target yields a result; unevaluable kinds report `ran: false`.
 */
export function checkDimensionTargets(
  run: CadRunResult,
  targets: DimensionTarget[] | null | undefined
): DimensionCheckResult[] {
  if (!targets?.length) return [];
  const dims = run.geometry?.dimensions;
  // B-rep topology for feature-level (diameter/distance) evaluation. Parsed
  // once per call, lazily — most runs carry only bbox/count/fit targets.
  let topoParsed = false;
  let topo: ReturnType<typeof parseTopology> = null;
  const getTopo = () => {
    if (!topoParsed) {
      topoParsed = true;
      topo = run.topo != null ? parseTopology(run.topo) : null;
    }
    return topo;
  };

  return targets.map((target): DimensionCheckResult => {
    const tolerance = defaultTolerance(target);

    if (isFitTargetKind(target.kind)) {
      // Component-fit targets (MTR-204): evaluated by the sidecar against the
      // real built mesh; here we only map its verdicts back onto the targets.
      const fit = run.checks?.fit;
      const res = target.id
        ? fit?.results?.find((r) => r.id === target.id)
        : undefined;
      if (!res || res.ok == null) {
        return {
          target,
          ran: false,
          ok: null,
          tolerance,
          note:
            res?.note ??
            fit?.error ??
            "fit check did not run on the sidecar (no fit data on the run)",
        };
      }
      const got = res.got;
      return {
        target,
        ran: true,
        ok: res.ok,
        got,
        delta: got != null ? Math.abs(got - target.value) : undefined,
        tolerance,
        note: res.note,
      };
    }

    if (target.kind === "bbox_span") {
      const axis = target.axis;
      if (!axis) {
        return { target, ran: false, ok: null, note: "bbox_span target has no axis" };
      }
      const got = dims?.[axis];
      if (got == null) {
        return { target, ran: false, ok: null, tolerance, note: "no geometry stats on the run" };
      }
      const delta = Math.abs(got - target.value);
      return { target, ran: true, ok: delta <= tolerance, got, delta, tolerance };
    }

    if (target.kind === "count") {
      const of = target.of ?? "solid";
      const got = of === "part"
        ? (run.parts?.length ?? (run.ok ? 1 : null))
        : solidCount(run);
      if (got == null) {
        return { target, ran: false, ok: null, tolerance, note: `no ${of} count on the run` };
      }
      const delta = Math.abs(got - target.value);
      return { target, ran: true, ok: delta <= tolerance, got, delta, tolerance };
    }

    // diameter / distance: measured against the B-rep topology manifest
    // (lib/cad/feature-dimensions.ts). Deterministic — the matched faces (and
    // only real, measured geometry) back both the verdict and the viewer
    // annotation anchor. No manifest → honesty rail, not-run.
    const t = getTopo();
    if (!t) {
      return {
        target,
        ran: false,
        ok: null,
        tolerance,
        note: `${target.kind} checks need the B-rep topology manifest — not present on this run`,
      };
    }
    const match =
      target.kind === "diameter"
        ? resolveDiameter(t, target.value)
        : resolveDistance(t, target.value);
    if (!match) {
      // The topology is real and was searched: no feature lands anywhere near
      // the spec value. That IS the check failing — the geometry the callout
      // promises does not exist (within the ±capture band).
      const featureName =
        target.kind === "diameter" ? "cylindrical feature" : "parallel-face pair";
      return {
        target,
        ran: true,
        ok: false,
        tolerance,
        note: `no ${featureName} found within ±${captureBandMm(target.value).toFixed(1)} mm of ${target.value} mm`,
      };
    }
    const delta = Math.abs(match.measured - target.value);
    return {
      target,
      ran: true,
      ok: delta <= tolerance,
      got: match.measured,
      delta,
      tolerance,
      note: match.note,
      faceIds: match.faceIds,
    };
  });
}

export interface DimensionCheckSummary {
  /** Targets total (including not-run). */
  total: number;
  /** Targets that were actually evaluated. */
  ran: number;
  /** Ran targets that passed. */
  passed: number;
  /** Ran targets that failed. */
  failed: number;
  /**
   * Honest "X/Y" over RAN checks only (passed/ran). null when nothing ran, so
   * the studio can withhold the "dimensions verified" chip entirely rather than
   * show a misleading 0/0.
   */
  label: string | null;
}

/** Aggregate for the studio chip + persistence. Counts only checks that ran. */
export function summarizeDimensionChecks(
  results: DimensionCheckResult[]
): DimensionCheckSummary {
  const ranResults = results.filter((r) => r.ran);
  const passed = ranResults.filter((r) => r.ok === true).length;
  const failed = ranResults.filter((r) => r.ok === false).length;
  return {
    total: results.length,
    ran: ranResults.length,
    passed,
    failed,
    label: ranResults.length > 0 ? `${passed}/${ranResults.length}` : null,
  };
}

/** Do any RAN checks fail? Only ran+failed count — never a not-run target. */
export function hasDimensionFailures(results: DimensionCheckResult[]): boolean {
  return results.some((r) => r.ran && r.ok === false);
}

/**
 * Targeted repair hints for the failed dimension targets — the actionable text
 * the harness appends to the repair note and the agentic loop returns as a tool
 * result ("overall height 42.0mm vs spec 50mm ±0.5, off by 8.0mm"). Empty when
 * nothing failed.
 */
export function formatDimensionRepairHints(
  results: DimensionCheckResult[]
): string {
  const lines = results
    .filter((r) => r.ran && r.ok === false)
    .map((r) => {
      // Fit failures (MTR-204) carry the sidecar's geometric diagnosis — the
      // note IS the actionable hint (which wall, which holes, which opening).
      if (isFitTargetKind(r.target.kind)) {
        return `- ${r.target.label}: FAILED — ${r.note ?? "component does not fit the built geometry"}`;
      }
      // Feature-level target with NO candidate geometry near spec (the
      // topology was searched; nothing matched) — the note says what's missing.
      if (r.got == null) {
        return `- ${r.target.label}: FAILED — ${r.note ?? "no matching feature in the built geometry"}. Model the feature the callout promises.`;
      }
      const unit = r.target.kind === "count" ? "" : "mm";
      const tol = r.tolerance ?? defaultTolerance(r.target);
      const axis = r.target.axis ? ` (${r.target.axis})` : "";
      return `- ${r.target.label}${axis}: measured ${r.got}${unit} vs spec ${r.target.value}${unit} ±${tol}${unit} — off by ${r.delta?.toFixed(2)}${unit}. Adjust the responsible named parameter and rebuild.`;
    });
  if (lines.length === 0) return "";
  return [
    "DIMENSION CONTRACT VIOLATIONS — these machine-checked callouts are out of spec; fix each by editing the named parameter (do NOT rescale the whole part):",
    ...lines,
  ].join("\n");
}

/**
 * Build the sidecar `checks.fit` request from the fit targets (MTR-204): the
 * ComponentFitSpec payloads ride the `fit_cavity` targets (one per component,
 * see fitTargetsForBrief). Null when the target list carries no fit specs —
 * the caller then omits `checks` entirely and the run behaves exactly as
 * before this feature existed.
 */
export function buildFitChecksFromTargets(
  targets: DimensionTarget[] | null | undefined
): { components: unknown[] } | null {
  const components = (targets ?? [])
    .filter((t) => t.kind === "fit_cavity" && t.fit != null)
    .map((t) => t.fit as unknown);
  return components.length > 0 ? { components } : null;
}

/**
 * Legacy bridge: turn the eval suite's `expectedDims` (x/y/z bbox) into
 * bbox_span targets, so evals run through the same machinery (MTR-201) instead
 * of the old parallel path in gradeRun.
 */
export function dimensionTargetsFromExpectedDims(
  expected: { x?: number; y?: number; z?: number } | null | undefined,
  tolMm?: number
): DimensionTarget[] {
  if (!expected) return [];
  const out: DimensionTarget[] = [];
  (["x", "y", "z"] as const).forEach((axis) => {
    const value = expected[axis];
    if (value != null) {
      out.push({
        label: `overall ${axis}`,
        kind: "bbox_span",
        axis,
        value,
        tolerance: tolMm,
      });
    }
  });
  return out;
}
