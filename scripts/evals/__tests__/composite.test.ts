import { describe, expect, it } from "vitest";

import {
  caseComposite,
  compositeScore,
  formatComposite,
  geometryAxis,
  isBrepExpectedTier,
  isEditabilityGated,
  runDeliveredBrep,
  specAxis,
  type CompositeSignals,
} from "../composite";
import type { CadRunResult } from "../../../lib/cad/types";

/**
 * Unit coverage for the MTR-228 editability-gated harmonic composite. Pure
 * math + deterministic signals — no model or sidecar needed. The load-bearing
 * contracts: the harmonic mean itself, BOTH zero-gates (either axis at 0 →
 * composite 0), the remesh/editability gate on a B-rep-expected case, and the
 * no-targets defaults (axis = 1 when there is nothing to measure).
 */

function signals(over: Partial<CompositeSignals> = {}): CompositeSignals {
  return {
    valid: true,
    dimsRan: 0,
    dimsPassed: 0,
    negTotal: 0,
    negClean: 0,
    brepExpected: true,
    brepDelivered: true,
    ...over,
  };
}

describe("compositeScore — zero-gated harmonic mean", () => {
  it("is the harmonic mean of the two axes", () => {
    // 2 * 0.5 * 1 / 1.5 = 2/3
    expect(compositeScore({ geometry: 0.5, spec: 1 })).toBeCloseTo(2 / 3, 10);
    expect(compositeScore({ geometry: 0.8, spec: 0.4 })).toBeCloseTo(
      (2 * 0.8 * 0.4) / 1.2,
      10
    );
  });

  it("equals the axes when they agree", () => {
    expect(compositeScore({ geometry: 1, spec: 1 })).toBe(1);
    expect(compositeScore({ geometry: 0.7, spec: 0.7 })).toBeCloseTo(0.7, 10);
  });

  it("sits below the arithmetic mean when axes disagree — no buying back", () => {
    const h = compositeScore({ geometry: 0.9, spec: 0.1 });
    expect(h).toBeLessThan(0.5);
    expect(h).toBeCloseTo((2 * 0.9 * 0.1) / 1.0, 10);
  });

  it("zero-gates on geometry = 0 (pretty blob, wrong recipe)", () => {
    expect(compositeScore({ geometry: 0, spec: 1 })).toBe(0);
  });

  it("zero-gates on spec = 0 (right dims, spec violated)", () => {
    expect(compositeScore({ geometry: 1, spec: 0 })).toBe(0);
  });

  it("clamps out-of-range inputs", () => {
    expect(compositeScore({ geometry: 2, spec: 1 })).toBe(1);
    expect(compositeScore({ geometry: -1, spec: 1 })).toBe(0);
  });
});

describe("geometryAxis — validity-gated dim accuracy", () => {
  it("is 0 for an invalid run regardless of dim results", () => {
    expect(
      geometryAxis(signals({ valid: false, dimsRan: 3, dimsPassed: 3 }))
    ).toBe(0);
  });

  it("is the passed/ran fraction when valid", () => {
    expect(geometryAxis(signals({ dimsRan: 4, dimsPassed: 3 }))).toBe(0.75);
  });

  it("defaults to 1 when valid and no dim targets ran (geometry-only case)", () => {
    expect(geometryAxis(signals({ dimsRan: 0 }))).toBe(1);
  });
});

describe("specAxis — spec consistency over dims + negative checks", () => {
  it("is the satisfied fraction across both populations", () => {
    // 3/4 dims + 1/2 negs = 4/6
    expect(
      specAxis(signals({ dimsRan: 4, dimsPassed: 3, negTotal: 2, negClean: 1 }))
    ).toBeCloseTo(4 / 6, 10);
  });

  it("defaults to 1 when the case has neither dims nor negative checks", () => {
    expect(specAxis(signals())).toBe(1);
  });

  it("is 0 when everything in the spec was violated", () => {
    expect(
      specAxis(signals({ dimsRan: 2, dimsPassed: 0, negTotal: 1, negClean: 0 }))
    ).toBe(0);
  });
});

describe("caseComposite — the editability gate", () => {
  it("gates a B-rep-expected case that came back remeshed to 0, even with perfect sub-metrics", () => {
    const s = signals({
      dimsRan: 3,
      dimsPassed: 3,
      negTotal: 2,
      negClean: 2,
      brepExpected: true,
      brepDelivered: false,
    });
    expect(isEditabilityGated(s)).toBe(true);
    expect(caseComposite(s)).toBe(0);
  });

  it("does NOT gate a mesh-mode case (implicit tiers) on the same signals", () => {
    const s = signals({ brepExpected: false, brepDelivered: false });
    expect(isEditabilityGated(s)).toBe(false);
    expect(caseComposite(s)).toBe(1);
  });

  it("computes the harmonic mean when the gate passes", () => {
    const s = signals({ dimsRan: 2, dimsPassed: 1, negTotal: 2, negClean: 2 });
    // geometry = 1/2; spec = 3/4; harmonic = 2*(0.5*0.75)/1.25 = 0.6
    expect(caseComposite(s)).toBeCloseTo(0.6, 10);
  });

  it("zero-gates an invalid run (opaque mesh / no solid) even with a clean spec", () => {
    const s = signals({ valid: false, negTotal: 2, negClean: 2 });
    expect(caseComposite(s)).toBe(0);
  });
});

describe("isBrepExpectedTier — the mesh-mode carve-out", () => {
  it("expects a B-rep everywhere except the implicit tiers", () => {
    expect(isBrepExpectedTier("primitive")).toBe(true);
    expect(isBrepExpectedTier("benchmark")).toBe(true);
    expect(isBrepExpectedTier("assembly")).toBe(true);
    expect(isBrepExpectedTier("revision")).toBe(true);
    expect(isBrepExpectedTier("implicit")).toBe(false);
    expect(isBrepExpectedTier("implicit-composite")).toBe(false);
  });
});

describe("runDeliveredBrep — the remesh signal", () => {
  const base: CadRunResult = {
    ok: true,
    files: {},
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
  };

  it("is true for a clean run", () => {
    expect(runDeliveredBrep(base)).toBe(true);
  });

  it("is false when the run was voxel-remeshed (the last-attempt escape)", () => {
    expect(runDeliveredBrep({ ...base, remeshed: true })).toBe(false);
  });

  it("is false when ANY assembly part was remeshed", () => {
    expect(
      runDeliveredBrep({
        ...base,
        parts: [
          { name: "base", files: {}, validation: base.validation },
          { name: "lid", files: {}, validation: base.validation, remeshed: true },
        ],
      })
    ).toBe(false);
  });
});

describe("formatComposite", () => {
  it("renders two decimals", () => {
    expect(formatComposite(0)).toBe("0.00");
    expect(formatComposite(2 / 3)).toBe("0.67");
    expect(formatComposite(1)).toBe("1.00");
  });
});
