import { describe, expect, it } from "vitest";

import {
  pearson,
  correlateJudgeVsHuman,
  driftCheck,
  type CalibrationSample,
  type FixtureBaseline,
  type FixtureLive,
} from "@/lib/cad/critique-calibration";

describe("pearson", () => {
  it("is +1 for a perfect positive line and -1 for a negative line", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
  });
  it("is null for <2 points or zero-variance series", () => {
    expect(pearson([1], [1])).toBeNull();
    expect(pearson([5, 5, 5], [1, 0, 1])).toBeNull();
  });
});

describe("correlateJudgeVsHuman (MTR-184)", () => {
  function sample(
    rating: string | null,
    score: number | null,
    dims: Record<string, number>
  ): CalibrationSample {
    return {
      rating,
      aestheticScore: score,
      aestheticDims: Object.fromEntries(
        Object.entries(dims).map(([k, v]) => [k, { score: v }])
      ),
    };
  }

  it("ignores unrated rows and counts good/bad", () => {
    const rep = correlateJudgeVsHuman([
      sample("good", 90, { proportion: 5, cohesion: 5, recognizability: 5, surfacing: 5, refinement: 5 }),
      sample(null, 50, { proportion: 3, cohesion: 3, recognizability: 3, surfacing: 3, refinement: 3 }),
      sample("bad", 40, { proportion: 2, cohesion: 2, recognizability: 2, surfacing: 2, refinement: 2 }),
    ]);
    expect(rep.ratedRows).toBe(2);
    expect(rep.goodRows).toBe(1);
    expect(rep.badRows).toBe(1);
  });

  it("finds a strong positive correlation when the judge tracks humans", () => {
    const samples = [
      sample("good", 92, { proportion: 5, cohesion: 5, recognizability: 5, surfacing: 4, refinement: 5 }),
      sample("good", 85, { proportion: 4, cohesion: 5, recognizability: 5, surfacing: 4, refinement: 4 }),
      sample("bad", 45, { proportion: 2, cohesion: 2, recognizability: 3, surfacing: 2, refinement: 2 }),
      sample("bad", 38, { proportion: 1, cohesion: 2, recognizability: 2, surfacing: 2, refinement: 1 }),
    ];
    const rep = correlateJudgeVsHuman(samples);
    expect(rep.aggregate.correlation).toBeGreaterThan(0.9);
    expect(rep.aggregate.meanWhenGood!).toBeGreaterThan(rep.aggregate.meanWhenBad!);
    const prop = rep.perDimension.find((d) => d.metric === "proportion")!;
    expect(prop.correlation).toBeGreaterThan(0.8);
    expect(prop.n).toBe(4);
  });

  it("flags a dimension the judge scores backwards from humans", () => {
    // surfacing scored HIGH on the human-bad rows and low on the good ones →
    // negative correlation → that rubric line disagrees with taste.
    const samples = [
      sample("good", 80, { proportion: 5, cohesion: 5, recognizability: 5, surfacing: 1, refinement: 5 }),
      sample("good", 78, { proportion: 5, cohesion: 5, recognizability: 5, surfacing: 2, refinement: 5 }),
      sample("bad", 42, { proportion: 2, cohesion: 2, recognizability: 2, surfacing: 5, refinement: 2 }),
      sample("bad", 40, { proportion: 2, cohesion: 2, recognizability: 2, surfacing: 5, refinement: 2 }),
    ];
    const rep = correlateJudgeVsHuman(samples);
    const surf = rep.perDimension.find((d) => d.metric === "surfacing")!;
    expect(surf.correlation).toBeLessThan(0);
  });

  it("counts per-metric n honestly when a dimension is missing on some rows", () => {
    const rep = correlateJudgeVsHuman([
      { rating: "good", aestheticScore: 90, aestheticDims: { proportion: { score: 5 } } },
      { rating: "bad", aestheticScore: 40, aestheticDims: null },
    ]);
    const prop = rep.perDimension.find((d) => d.metric === "proportion")!;
    expect(prop.n).toBe(1); // only the row that had the dim
    expect(prop.correlation).toBeNull(); // n<2
    expect(rep.aggregate.n).toBe(2); // both had an aggregate score
  });
});

describe("driftCheck (MTR-184)", () => {
  const baselines: FixtureBaseline[] = [
    { id: "clean-bracket", aggregate: 82, dims: { proportion: 4, cohesion: 5 } },
    { id: "blobby-fail", aggregate: 45, dims: { proportion: 2, cohesion: 2 } },
  ];

  it("passes when the live judge matches the baselines within tolerance", () => {
    const live: FixtureLive[] = [
      { id: "clean-bracket", aggregate: 84, dims: { proportion: 4, cohesion: 5 } },
      { id: "blobby-fail", aggregate: 47, dims: { proportion: 2, cohesion: 3 } },
    ];
    expect(driftCheck(baselines, live).pass).toBe(true);
  });

  it("fails when a perturbed rubric shifts the live scores past tolerance", () => {
    // A rubric edit inflates everything by ~20 points / +2 dims.
    const live: FixtureLive[] = [
      { id: "clean-bracket", aggregate: 82, dims: { proportion: 4, cohesion: 5 } },
      { id: "blobby-fail", aggregate: 68, dims: { proportion: 4, cohesion: 4 } },
    ];
    const rep = driftCheck(baselines, live);
    expect(rep.pass).toBe(false);
    const bad = rep.results.find((r) => r.id === "blobby-fail")!;
    expect(bad.pass).toBe(false);
    expect(bad.reasons.join(" ")).toMatch(/aggregate drifted/);
  });

  it("fails a fixture the judge produced no score for", () => {
    const rep = driftCheck(baselines, [
      { id: "clean-bracket", aggregate: 82, dims: { proportion: 4, cohesion: 5 } },
    ]);
    expect(rep.pass).toBe(false);
    expect(rep.results.find((r) => r.id === "blobby-fail")!.reasons[0]).toMatch(
      /no live score/
    );
  });
});
