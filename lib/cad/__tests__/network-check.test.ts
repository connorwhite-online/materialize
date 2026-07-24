import { describe, expect, it } from "vitest";

import {
  getNetworksReport,
  networksFailure,
  networksInconclusive,
  networksSummary,
} from "../network-check";
import type { CadNetworksReport, CadRunResult } from "../types";

const run = (networks?: CadNetworksReport): CadRunResult =>
  ({
    ok: true,
    files: {},
    validation: { compiled: true, isSolid: true, isWatertight: true },
    checks: networks ? { networks } : undefined,
  }) as CadRunResult;

describe("getNetworksReport", () => {
  it("returns the report when the check ran", () => {
    const report: CadNetworksReport = { isolated: true, pitch: 0.5 };
    expect(getNetworksReport(run(report))).toEqual(report);
  });

  it("tolerates runs without checks (most parts have no fluid circuits)", () => {
    expect(getNetworksReport(run())).toBeUndefined();
    expect(getNetworksReport(undefined)).toBeUndefined();
  });
});

describe("networksFailure", () => {
  it("is null when the check did not run — absence is not failure", () => {
    expect(networksFailure(undefined)).toBeNull();
    expect(networksFailure(null)).toBeNull();
  });

  it("is null when verified isolated", () => {
    expect(
      networksFailure({
        isolated: true,
        components: 2,
        pitch: 0.5,
        ports: { a_in: 1, a_out: 1, b_in: 2, b_out: 2 },
      })
    ).toBeNull();
  });

  it("surfaces a check-level error with the fix", () => {
    const msg = networksFailure({ error: "boom" });
    expect(msg).toContain("boom");
    expect(msg).toContain("fluid_ports");
  });

  it("diagnoses a leak when two circuits share a void", () => {
    const msg = networksFailure({
      isolated: false,
      pitch: 0.62,
      ports: { a_in: 1, a_out: 1, b_in: 1, b_out: 1 },
    });
    expect(msg).toContain("LEAK");
    expect(msg).toContain("0.62");
    expect(msg).toContain('"a"');
    expect(msg).toContain('"b"');
  });

  it("diagnoses a blockage when one circuit splits across voids", () => {
    const msg = networksFailure({
      isolated: false,
      ports: { a_in: 1, a_out: 3, b_in: 2, b_out: 2 },
    });
    expect(msg).toContain('"a"');
    expect(msg).toContain("blockage");
    expect(msg).not.toContain("LEAK");
  });

  it("diagnoses a lost probe (port found only solid)", () => {
    const msg = networksFailure({
      isolated: false,
      ports: { a_in: null, a_out: 1, b_in: 2, b_out: 2 },
    });
    expect(msg).toContain("a_in");
    expect(msg).toContain("only solid");
  });

  it("still fails legibly when isolated=false with no visible cause", () => {
    // e.g. a probe straddling two voids flips `ambiguous` sidecar-side.
    const msg = networksFailure({
      isolated: false,
      ports: { a_in: 1, a_out: 1, b_in: 2, b_out: 2 },
    });
    expect(msg).toBeTruthy();
  });
});

describe("networksSummary", () => {
  it("states the resolution bound, never 'leak-free'", () => {
    const msg = networksSummary({
      isolated: true,
      components: 2,
      pitch: 0.5,
      minWallVoxels: 2,
    });
    expect(msg).toContain("no leak wider than ~0.50mm");
    expect(msg).toContain("min wall >= 1.0mm");
    expect(msg).not.toMatch(/leak-free/i);
  });

  it("is null when the check did not run or errored", () => {
    expect(networksSummary(undefined)).toBeNull();
    expect(networksSummary({ error: "boom" })).toBeNull();
  });

  it("is null when inconclusive — nothing was verified", () => {
    expect(
      networksSummary({ inconclusive: true, pitch: 2.7, reason: "too big" })
    ).toBeNull();
  });
});

describe("inconclusive reports (probe cannot resolve declared walls)", () => {
  const report = {
    inconclusive: true,
    pitch: 2.66,
    reason:
      "probe pitch 2.66mm cannot resolve the declared 1.2mm minimum feature within the voxel budget — isolation is UNVERIFIED at this scale (a verdict here would alias walls into phantom leaks)",
  };

  it("is NOT a failure — no repair turn, no leak verdict on noise", () => {
    expect(networksFailure(report)).toBeNull();
  });

  it("networksInconclusive carries the sidecar's reason for the UI", () => {
    expect(networksInconclusive(report)).toContain("UNVERIFIED");
  });

  it("networksInconclusive falls back to generic copy without a reason", () => {
    const msg = networksInconclusive({ inconclusive: true, pitch: 2.66 });
    expect(msg).toContain("not verified");
    expect(msg).toContain("2.66");
  });

  it("networksInconclusive is null for conclusive or absent reports", () => {
    expect(networksInconclusive(undefined)).toBeNull();
    expect(networksInconclusive({ isolated: true })).toBeNull();
    expect(networksInconclusive({ isolated: false })).toBeNull();
  });
});
