import { describe, it, expect } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";
import {
  checkDimensionTargets,
  summarizeDimensionChecks,
  hasDimensionFailures,
  formatDimensionRepairHints,
  dimensionTargetsFromExpectedDims,
  defaultTolerance,
  type DimensionTarget,
} from "@/lib/cad/dimension-check";

function run(over: Partial<CadRunResult> = {}): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: { x: 100, y: 60, z: 20 } },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
    ...over,
  };
}

describe("checkDimensionTargets — bbox_span (MTR-197)", () => {
  it("passes an on-target span and fails an off-target one", () => {
    const targets: DimensionTarget[] = [
      { label: "length", kind: "bbox_span", axis: "x", value: 100, tolerance: 1 },
      { label: "height", kind: "bbox_span", axis: "z", value: 50, tolerance: 0.5 },
    ];
    const results = checkDimensionTargets(run(), targets);
    expect(results[0]).toMatchObject({ ran: true, ok: true, got: 100, delta: 0 });
    expect(results[1]).toMatchObject({ ran: true, ok: false, got: 20 });
    expect(results[1].delta).toBe(30);
  });

  it("does not run when geometry stats are absent (honesty rail)", () => {
    const results = checkDimensionTargets(run({ geometry: undefined }), [
      { label: "length", kind: "bbox_span", axis: "x", value: 100 },
    ]);
    expect(results[0].ran).toBe(false);
    expect(results[0].ok).toBeNull();
  });

  it("does not run a bbox_span target that omits an axis", () => {
    const results = checkDimensionTargets(run(), [
      { label: "bad", kind: "bbox_span", value: 100 },
    ]);
    expect(results[0].ran).toBe(false);
    expect(results[0].ok).toBeNull();
  });
});

describe("checkDimensionTargets — count", () => {
  it("checks solid count from bodyCount", () => {
    const ok = checkDimensionTargets(run(), [
      { label: "one solid", kind: "count", value: 1 },
    ]);
    expect(ok[0]).toMatchObject({ ran: true, ok: true, got: 1 });

    const bad = checkDimensionTargets(run({ validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true, bodyCount: 3 } }), [
      { label: "one solid", kind: "count", value: 1 },
    ]);
    expect(bad[0]).toMatchObject({ ran: true, ok: false, got: 3 });
  });

  it("checks part count from the parts breakdown", () => {
    const r = run({ parts: [{ name: "a", files: {}, validation: run().validation }, { name: "b", files: {}, validation: run().validation }] });
    const res = checkDimensionTargets(r, [
      { label: "two parts", kind: "count", of: "part", value: 2 },
    ]);
    expect(res[0]).toMatchObject({ ran: true, ok: true, got: 2 });
  });
});

describe("checkDimensionTargets — diameter/distance not yet evaluable", () => {
  it("reports ran:false with a MTR-196 note (never silently passing)", () => {
    const res = checkDimensionTargets(run(), [
      { label: "hole dia", kind: "diameter", value: 8 },
      { label: "hole pitch", kind: "distance", value: 35 },
    ]);
    expect(res.every((r) => r.ran === false && r.ok === null)).toBe(true);
    expect(res[0].note).toMatch(/MTR-196/);
  });
});

describe("summaries + hints (honesty rails)", () => {
  it("counts only checks that ran and labels null when nothing ran", () => {
    const results = checkDimensionTargets(run(), [
      { label: "length", kind: "bbox_span", axis: "x", value: 100, tolerance: 1 },
      { label: "hole dia", kind: "diameter", value: 8 },
    ]);
    const s = summarizeDimensionChecks(results);
    expect(s).toMatchObject({ total: 2, ran: 1, passed: 1, failed: 0, label: "1/1" });

    const nothingRan = summarizeDimensionChecks(
      checkDimensionTargets(run(), [{ label: "hole dia", kind: "diameter", value: 8 }])
    );
    expect(nothingRan.label).toBeNull();
  });

  it("hasDimensionFailures / formatDimensionRepairHints only fire on ran+failed", () => {
    const results = checkDimensionTargets(run(), [
      { label: "height", kind: "bbox_span", axis: "z", value: 50, tolerance: 0.5 },
      { label: "hole dia", kind: "diameter", value: 8 },
    ]);
    expect(hasDimensionFailures(results)).toBe(true);
    const hint = formatDimensionRepairHints(results);
    expect(hint).toMatch(/height/);
    expect(hint).toMatch(/50mm/);
    expect(hint).toMatch(/off by 30/);
    // The not-run diameter target never appears in the repair hint.
    expect(hint).not.toMatch(/hole dia/);
  });

  it("emits no hint when everything on-target", () => {
    const results = checkDimensionTargets(run(), [
      { label: "length", kind: "bbox_span", axis: "x", value: 100, tolerance: 1 },
    ]);
    expect(hasDimensionFailures(results)).toBe(false);
    expect(formatDimensionRepairHints(results)).toBe("");
  });
});

describe("defaults + legacy bridge", () => {
  it("default tolerance is 2% floored at 0.5mm, exact for counts", () => {
    expect(defaultTolerance({ label: "", kind: "bbox_span", axis: "x", value: 10 })).toBe(0.5);
    expect(defaultTolerance({ label: "", kind: "bbox_span", axis: "x", value: 100 })).toBe(2);
    expect(defaultTolerance({ label: "", kind: "count", value: 4 })).toBe(0);
  });

  it("dimensionTargetsFromExpectedDims maps x/y/z to bbox_span targets", () => {
    const targets = dimensionTargetsFromExpectedDims({ x: 100, z: 20 }, 2);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ kind: "bbox_span", axis: "x", value: 100, tolerance: 2 });
    // A run matching them passes through the shared machinery.
    const res = checkDimensionTargets(run(), targets);
    expect(res.every((r) => r.ran && r.ok)).toBe(true);
  });
});
