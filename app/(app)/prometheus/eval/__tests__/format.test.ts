import { describe, it, expect } from "vitest";

import { fmtRate, fmtAvg, fmtScore, fmtCost } from "../page";
import type { CostBucket } from "@/lib/cad/analysis/cost-rollup";

/**
 * MTR-205 — pure display helpers for the outcomes/cost section. The load-
 * bearing behavior is honesty on sparse data: a null rate (nothing to divide
 * by) must read "—", never a misleading 0%.
 */
describe("fmtRate", () => {
  it("renders a fraction as a rounded percent", () => {
    expect(fmtRate(0)).toBe("0%");
    expect(fmtRate(0.5)).toBe("50%");
    expect(fmtRate(0.333)).toBe("33%");
    expect(fmtRate(1)).toBe("100%");
  });

  it("renders null (empty denominator) as a dash, not 0%", () => {
    expect(fmtRate(null)).toBe("—");
  });
});

describe("fmtAvg / fmtScore", () => {
  it("formats averages to one decimal, null to a dash", () => {
    expect(fmtAvg(2.5)).toBe("2.5");
    expect(fmtAvg(3)).toBe("3.0");
    expect(fmtAvg(null)).toBe("—");
  });

  it("rounds aesthetic scores, null to a dash", () => {
    expect(fmtScore(87.4)).toBe("87");
    expect(fmtScore(null)).toBe("—");
  });
});

function bucket(partial: Partial<CostBucket>): CostBucket {
  return {
    key: "simple",
    jobs: 1,
    costCents: 0,
    snapshotCostCents: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    modelMs: 0,
    sidecarMs: 0,
    falCalls: 0,
    ...partial,
  };
}

describe("fmtCost", () => {
  it("shows a dash when there is no metered job for the slice", () => {
    expect(fmtCost(undefined)).toBe("—");
    expect(fmtCost(bucket({ jobs: 0 }))).toBe("—");
  });

  it("prefers dollars when the priced cost is non-zero", () => {
    expect(fmtCost(bucket({ costCents: 250 }))).toBe("$2.50");
  });

  it("falls back to token volume when prices are at their 0 defaults", () => {
    expect(fmtCost(bucket({ inputTokens: 400, outputTokens: 350 }))).toBe(
      "750 tok"
    );
    expect(fmtCost(bucket({ inputTokens: 1200, outputTokens: 800 }))).toBe(
      "2.0k tok"
    );
  });

  it("shows a dash when a metered job recorded no tokens and no cost", () => {
    expect(fmtCost(bucket({ jobs: 2 }))).toBe("—");
  });
});
