/**
 * Multi-turn revision grading (MTR-183). The product is a revision loop, but
 * the frozen eval set was single-shot only. A revision turn has TWO things to
 * verify, and this module makes both deterministic and testable without a live
 * model:
 *
 *   (a) the requested delta LANDED — the named parameter moved to the asked
 *       value, or the asked feature introduced a new named parameter; and
 *   (b) nothing else REGRESSED — the result stayed valid and the axes the edit
 *       was not supposed to touch held their prior extent.
 *
 * Assertion tooling is reused, not reinvented: `extractParams` / `diffParams`
 * from components/cad/param-diff.ts read the parametric delta out of the source
 * (the code is parametric by contract), and the sidecar geometry drives the
 * bbox non-regression check. Pure — safe to unit-test and to import from the
 * standalone runner.
 */
import {
  extractParams,
  diffParams,
} from "../../components/cad/param-diff";
import { gradeRun, type ExpectedDims } from "../../lib/cad/prompt";
import type { CadRunResult } from "../../lib/cad/types";

type Axis = "x" | "y" | "z";

/** What a single revision turn must be true of the revised model. */
export interface TurnAssert {
  /**
   * A named top-level parameter that must land at (about) this value after the
   * turn — the requested parametric delta ("make the wall 2.4mm").
   */
  paramChanged?: { name: string; to: number; tol?: number };
  /**
   * A named parameter that must NEWLY appear — a feature-add turn ("add a USB-C
   * cutout") is expected to introduce at least this parameter.
   */
  paramAdded?: string;
  /** Overall bounding-box targets (mm) the revised model must hit. */
  expectDims?: ExpectedDims;
  /**
   * Axes whose extent must NOT move materially from the PRIOR turn — the
   * non-regression guard (an edit to the wall must not silently resize the box).
   */
  holdDims?: { axes: Axis[]; tol?: number };
}

/** One scripted revision turn appended to a case. */
export interface EvalTurn {
  /** The revision instruction, as the studio would serialize it. */
  instruction: string;
  /**
   * Feedback tags to thread as prior-version feedback (exercises the
   * priorFeedback path, e.g. `["dimensions_off"]`). Optional.
   */
  feedbackTags?: string[];
  /**
   * A free-text feedback note threaded alongside the tags. When the corrective
   * TARGET lives here (not in `instruction`), a runner that drops priorFeedback
   * threading loses the target and the case fails — the MTR-183 acceptance test.
   */
  feedbackNote?: string;
  assert: TurnAssert;
}

export interface TurnGrade {
  pass: boolean;
  failures: string[];
}

const DEFAULT_PARAM_TOL = 0.05;
const DEFAULT_HOLD_TOL = 1.5;

/**
 * Grade one revision turn against the prior turn's state. `prev*` is the state
 * being revised (turn N-1, or the initial generation for the first turn);
 * `next*` is the revised state produced from the instruction.
 */
export function gradeTurn(opts: {
  prevCode: string;
  nextCode: string;
  prevRun: CadRunResult;
  nextRun: CadRunResult;
  assert: TurnAssert;
}): TurnGrade {
  const { prevCode, nextCode, prevRun, nextRun, assert } = opts;
  const failures: string[] = [];

  // (0) The revised model must still be a valid, printable solid — a revision
  // that breaks the part is a regression no matter what the delta says.
  const base = gradeRun(nextRun);
  if (!base.pass) failures.push(`invalid after revision: ${base.failures.join(", ")}`);

  const prevParams = extractParams(prevCode);
  const nextParams = extractParams(nextCode);
  const delta = diffParams(prevParams, nextParams);

  // (a) The requested parametric delta landed.
  if (assert.paramChanged) {
    const { name, to, tol = DEFAULT_PARAM_TOL } = assert.paramChanged;
    const got = nextParams[name];
    if (got == null) {
      failures.push(`param "${name}" absent after revision (delta did not land)`);
    } else if (Math.abs(got - to) > tol) {
      failures.push(`param "${name}" = ${got}, wanted ${to} (±${tol})`);
    } else if (name in prevParams && prevParams[name] === to) {
      // It was already at the target — the turn asserted a change that could
      // not be observed. Treat as a mis-specified case, surfaced loudly.
      failures.push(`param "${name}" was already ${to} before the turn`);
    }
  }

  if (assert.paramAdded) {
    const added = delta.added.some(([n]) => n === assert.paramAdded);
    const present = assert.paramAdded in nextParams;
    if (!present) {
      failures.push(`expected new param "${assert.paramAdded}" not present`);
    } else if (!added) {
      failures.push(`param "${assert.paramAdded}" existed before — not a new feature`);
    }
  }

  // (b) Non-regression: axes the edit shouldn't touch held their prior extent.
  if (assert.holdDims) {
    const tol = assert.holdDims.tol ?? DEFAULT_HOLD_TOL;
    const p = prevRun.geometry?.dimensions;
    const n = nextRun.geometry?.dimensions;
    if (!p || !n) {
      failures.push("cannot check non-regression — missing geometry");
    } else {
      for (const ax of assert.holdDims.axes) {
        if (Math.abs(n[ax] - p[ax]) > tol) {
          failures.push(
            `axis ${ax} regressed: ${p[ax].toFixed(2)} → ${n[ax].toFixed(2)} (>${tol}mm)`
          );
        }
      }
    }
  }

  // Overall dimensional target after the turn (mm).
  if (assert.expectDims) {
    const d = gradeRun(nextRun, assert.expectDims);
    if (d.dimsOk === false) failures.push("post-revision dimensions off target");
  }

  return { pass: failures.length === 0, failures };
}
