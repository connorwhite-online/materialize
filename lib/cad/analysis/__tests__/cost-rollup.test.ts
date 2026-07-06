import { describe, it, expect, vi } from "vitest";

// The loader needs a db; the pure aggregation under test does not.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  rollupJobCosts,
  type CostJobInput,
} from "@/lib/cad/analysis/cost-rollup";
import type { CadUnitPrices } from "@/lib/billing/cad-pricing";
import type { CadUsageSummary } from "@/lib/cad/types";

function usage(partial: Partial<CadUsageSummary>): CadUsageSummary {
  return {
    v: 1,
    model: [],
    sidecar: { calls: 0, ms: 0 },
    fal: [],
    ...partial,
  };
}

const zeroPrices: CadUnitPrices = {
  inputCentsPerMTok: 0,
  outputCentsPerMTok: 0,
  cacheReadCentsPerMTok: 0,
  cacheWriteCentsPerMTok: 0,
  modelOverrides: {},
  sidecarCentsPerMinute: 0,
  falCentsPerCall: 0,
  falCentsByModel: {},
};

const jobs: CostJobInput[] = [
  {
    usage: usage({
      route: "simple",
      model: [
        {
          role: "implement",
          model: "m",
          calls: 2,
          inputTokens: 1_000_000,
          outputTokens: 200_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          ms: 5000,
        },
      ],
      sidecar: { calls: 3, ms: 60_000 },
    }),
    costCents: 4,
    fingerprint: { v: 1, route: "simple" },
  },
  {
    usage: usage({
      route: "simple",
      model: [
        {
          role: "plan",
          model: "m",
          calls: 1,
          inputTokens: 500_000,
          outputTokens: 100_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          ms: 1000,
        },
      ],
    }),
    costCents: 2,
    fingerprint: { v: 1, route: "simple" },
  },
  {
    usage: usage({
      route: "organic",
      fal: [{ model: "fal-ai/hunyuan3d/v2", calls: 1, ms: 30_000 }],
    }),
    costCents: 16,
    fingerprint: { v: 1, route: "organic" },
  },
  // Pre-metering row — must be excluded, not counted as a free job.
  { usage: null, costCents: null, fingerprint: null },
];

describe("rollupJobCosts", () => {
  it("buckets metered jobs by key with token/wall-time aggregates", () => {
    const buckets = rollupJobCosts(
      jobs,
      (j) => j.usage?.route ?? "unknown",
      zeroPrices
    );
    expect(buckets.map((b) => b.key)).toEqual(["simple", "organic"]);

    const simple = buckets[0];
    expect(simple.jobs).toBe(2);
    expect(simple.inputTokens).toBe(1_500_000);
    expect(simple.outputTokens).toBe(300_000);
    expect(simple.modelCalls).toBe(3);
    expect(simple.sidecarMs).toBe(60_000);
    expect(simple.snapshotCostCents).toBe(6);

    const organic = buckets[1];
    expect(organic.falCalls).toBe(1);
    expect(organic.snapshotCostCents).toBe(16);
  });

  it("recomputes costCents at the GIVEN prices, independent of the snapshot", () => {
    // At 0 prices, recomputed cost is 0 while snapshots stay what they were.
    const zero = rollupJobCosts(jobs, () => "all", zeroPrices)[0];
    expect(zero.costCents).toBe(0);
    expect(zero.snapshotCostCents).toBe(22);

    // Re-price: input 300c/MTok + fal map — history gets a new answer.
    const repriced = rollupJobCosts(jobs, () => "all", {
      ...zeroPrices,
      inputCentsPerMTok: 300,
      falCentsByModel: { "fal-ai/hunyuan3d/v2": 16 },
    })[0];
    // 1.0M*300 = 300 (rounded per job: 300) + 0.5M*300 = 150 + fal 16 = 466
    expect(repriced.costCents).toBe(466);
  });

  it("excludes unmetered (pre-migration) jobs from every bucket", () => {
    const buckets = rollupJobCosts(jobs, () => "all", zeroPrices);
    expect(buckets[0].jobs).toBe(3);
  });
});
