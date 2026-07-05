import { z } from "zod";

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
 * when the check actually RAN against real geometry. Kinds we cannot yet
 * evaluate deterministically (diameter/distance need per-face topology, which
 * arrives with MTR-196) are returned `ran: false, ok: null` — never silently
 * counted as passing. No user-visible "dimensions verified" claim may include
 * a check that did not run.
 */

/**
 * A machine-checkable dimension callout.
 * - `bbox_span`  — overall extent along an axis (from the exported mesh bbox).
 * - `count`      — number of solids/parts (from the sidecar's bodyCount /
 *                  parts breakdown). `of` selects which population.
 * - `diameter` / `distance` — feature-level measures that need per-face
 *                  topology (MTR-196); accepted here but reported as not-run
 *                  until that data lands, so the model still declares them.
 */
export type DimensionTargetKind = "bbox_span" | "diameter" | "distance" | "count";
export type DimensionAxis = "x" | "y" | "z";

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
}

/** Zod schema for a brief-emitted target — permissive, best-effort like the brief. */
export const dimensionTargetSchema = z.looseObject({
  label: z.string(),
  kind: z.enum(["bbox_span", "diameter", "distance", "count"]),
  axis: z.enum(["x", "y", "z"]).optional(),
  of: z.enum(["solid", "part"]).optional(),
  value: z.number(),
  tolerance: z.number().nonnegative().optional(),
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
}

/**
 * Default acceptance band when the target omits one: 2% of the target value,
 * floored at 0.5 mm — tight enough to catch order-of-magnitude and off-by-a-few
 * errors, loose enough not to fail on mesh-tessellation noise. Counts are exact.
 */
export function defaultTolerance(target: DimensionTarget): number {
  if (target.tolerance != null) return target.tolerance;
  if (target.kind === "count") return 0;
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

  return targets.map((target): DimensionCheckResult => {
    const tolerance = defaultTolerance(target);

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

    // diameter / distance: feature-level topology (MTR-196) not available yet.
    return {
      target,
      ran: false,
      ok: null,
      tolerance,
      note: `${target.kind} checks need per-face topology (MTR-196) — not evaluated`,
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
