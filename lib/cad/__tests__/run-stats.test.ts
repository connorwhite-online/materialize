import { describe, it, expect } from "vitest";

import { buildRunStats, splitTiming } from "@/lib/cad/run-stats";
import type { CadRunResult, CadUsageSummary } from "@/lib/cad/types";

function usage(modelMs: number[], sidecarMs: number): CadUsageSummary {
  return {
    v: 1,
    model: modelMs.map((ms, i) => ({
      role: `role${i}`,
      model: "m",
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ms,
    })),
    sidecar: { calls: 1, ms: sidecarMs },
    fal: [],
  };
}

function run(over: Partial<CadRunResult> = {}): CadRunResult {
  return {
    ok: true,
    files: {},
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
    geometry: { triangleCount: 12345 },
    ...over,
  };
}

describe("run stats", () => {
  it("splits model time from geometry time", () => {
    // The distinction the bake-off needs: "the LLM cannot write this" and
    // "the kernel cannot build this" call for completely different fixes.
    expect(splitTiming(usage([1000, 2500], 8000))).toEqual({
      modelMs: 3500,
      geometryMs: 8000,
    });
    expect(splitTiming(null)).toEqual({ modelMs: 0, geometryMs: 0 });
  });

  it("records the signals that were never persisted before", () => {
    const stats = buildRunStats({
      engine: "sdf",
      ok: true,
      attempts: 2,
      run: run(),
      usage: usage([500], 4000),
    });
    expect(stats).toMatchObject({
      v: 1,
      engine: "sdf",
      ok: true,
      attempts: 2,
      triangles: 12345,
      watertight: true,
      manifold: true,
      failureClass: null,
      modelMs: 500,
      geometryMs: 4000,
    });
  });

  it("classifies a failure from the sidecar's own error", () => {
    const stats = buildRunStats({
      engine: "brep",
      ok: false,
      attempts: 4,
      run: run({
        ok: false,
        error: "Failed creating a fillet with radius of 6, try a smaller value",
        validation: {
          compiled: true,
          isSolid: false,
          isWatertight: false,
          isManifold: false,
        },
      }),
      usage: usage([900], 1200),
    });
    expect(stats.ok).toBe(false);
    expect(stats.failureClass).toBe("fillet_chamfer_failure");
    expect(stats.watertight).toBe(false);
  });

  it("leaves the failure class null when nothing matches", () => {
    const stats = buildRunStats({
      engine: "sdf",
      ok: false,
      attempts: 1,
      error: "something entirely unfamiliar happened",
    });
    expect(stats.failureClass).toBeNull();
  });

  it("never turns an unrun DFM probe into a pass", () => {
    // The honesty rail, carried all the way from dfm.py to the DB: a probe
    // that did not run is unknown. A `?? true` anywhere on this path
    // recreates the false-pass the report exists to prevent.
    const stats = buildRunStats({
      engine: "sdf",
      ok: true,
      attempts: 1,
      run: run({
        checks: {
          dfm: {
            minWallOk: null,
            drainsOk: null,
            probesRan: false,
            ok: false,
            minWallError: "No module named 'rtree'",
          },
        },
      }),
    });
    expect(stats.dfm).toMatchObject({ ok: false, probesRan: false });
    expect(stats.dfm?.minWallMm).toBeNull();
  });

  it("drops a DFM report that errored outright", () => {
    const stats = buildRunStats({
      engine: "sdf",
      ok: true,
      attempts: 1,
      run: run({ checks: { dfm: { error: "probe exploded" } } }),
    });
    expect(stats.dfm).toBeNull();
  });
});
