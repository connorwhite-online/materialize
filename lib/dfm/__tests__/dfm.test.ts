import { describe, it, expect } from "vitest";
import { analyzeTriangles, sampleWallThickness } from "../mesh-analysis";
import { assessIssues, assessMaterials, assessProcesses } from "../printability";
import { recommendMaterials } from "../recommend";

/** Axis-aligned box [0,x]x[0,y]x[0,z] as 12 outward-facing triangles. */
function box(x: number, y: number, z: number): Float64Array {
  const v = [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return Float64Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}

describe("analyzeTriangles", () => {
  it("measures a closed box exactly", () => {
    const a = analyzeTriangles(box(20, 10, 2));
    expect(a.bboxMm).toEqual({ x: 20, y: 10, z: 2 });
    expect(a.volumeMm3).toBeCloseTo(400);
    expect(a.surfaceAreaMm2).toBeCloseTo(2 * (200 + 40 + 20));
    expect(a.topology).toEqual({ openEdges: 0, nonManifoldEdges: 0, shells: 1 });
    expect(a.invertedNormals).toBe(false);
    // 2V/A of a slab approximates its thickness.
    expect(a.meanThicknessMm).toBeCloseTo(1.54, 1);
  });

  it("applies the declared unit", () => {
    expect(analyzeTriangles(box(1, 1, 1), "in").bboxMm.x).toBeCloseTo(25.4);
  });

  it("finds a hole", () => {
    const t = box(10, 10, 10).slice(0, 11 * 9);
    const a = analyzeTriangles(t);
    expect(a.topology!.openEdges).toBeGreaterThan(0);
    expect(a.meanThicknessMm).toBeNull();
  });

  it("counts separate pieces", () => {
    const second = box(5, 5, 5).map((n, i) => (i % 3 === 0 ? n + 100 : n));
    const both = new Float64Array([...box(5, 5, 5), ...second]);
    expect(analyzeTriangles(both).topology!.shells).toBe(2);
  });

  it("flags inward-facing triangles", () => {
    const flipped = box(5, 5, 5);
    for (let i = 0; i < flipped.length; i += 9) {
      for (let c = 0; c < 3; c++) {
        const a = flipped[i + 3 + c];
        flipped[i + 3 + c] = flipped[i + 6 + c];
        flipped[i + 6 + c] = a;
      }
    }
    expect(analyzeTriangles(flipped).invertedNormals).toBe(true);
  });
});

describe("assessIssues", () => {
  it("blocks a mesh with holes", () => {
    const analysis = analyzeTriangles(box(10, 10, 10).slice(0, 11 * 9));
    const issues = assessIssues({ bboxMm: analysis.bboxMm, analysis, declaredUnit: "mm" });
    expect(issues.find((i) => i.code === "not_watertight")?.severity).toBe("blocker");
  });

  it("suggests the unit when a part is implausibly small", () => {
    const analysis = analyzeTriangles(box(0.3, 0.3, 0.3));
    const [issue] = assessIssues({ bboxMm: analysis.bboxMm, analysis, declaredUnit: "mm" });
    expect(issue.code).toBe("unit_suspect");
    expect(issue.fix).toMatch(/inches/);
  });

  it("is quiet about a healthy part", () => {
    const analysis = analyzeTriangles(box(40, 30, 20));
    expect(assessIssues({ bboxMm: analysis.bboxMm, analysis, declaredUnit: "mm" })).toEqual([]);
  });
});

describe("assessMaterials", () => {
  const facts = (x: number, y: number, z: number) => {
    const analysis = analyzeTriangles(box(x, y, z));
    return { bboxMm: analysis.bboxMm, analysis, declaredUnit: "mm" as const };
  };

  it("rules out materials the part is too big for", () => {
    const fits = assessMaterials(facts(200, 200, 200));
    expect(fits.find((f) => f.materialId === "resin-standard")?.verdict).toBe("no");
    expect(fits.find((f) => f.materialId === "pla-white")?.verdict).toBe("good");
  });

  it("warns about thin parts, harder on finer-limit processes last", () => {
    const fits = assessMaterials(facts(40, 40, 0.8));
    expect(fits.find((f) => f.materialId === "pla-white")?.verdict).not.toBe("good");
    expect(fits.find((f) => f.materialId === "resin-standard")?.verdict).toBe("good");
  });
});

describe("recommendMaterials", () => {
  it("meets hard needs and explains exclusions", () => {
    const r = recommendMaterials({ needs: { flexibility: 4 } });
    expect(r.picks.length).toBeGreaterThan(0);
    for (const p of r.picks) expect(p.scores.flexibility).toBeGreaterThanOrEqual(4);
    expect(r.ruledOut.some((x) => /flexible/.test(x.reason))).toBe(true);
  });

  it("honors a price ceiling and lists colour variants once", () => {
    const r = recommendMaterials({ maxPrice: "budget", limit: 10 });
    expect(r.picks.every((p) => p.priceTier === "budget")).toBe(true);
    expect(r.picks.filter((p) => p.name === "PLA")).toHaveLength(1);
  });

  it("drops materials the part cannot be made in", () => {
    const analysis = analyzeTriangles(box(200, 200, 200));
    const fits = assessMaterials({ bboxMm: analysis.bboxMm, analysis, declaredUnit: "mm" });
    const r = recommendMaterials({ fits, limit: 20 });
    expect(r.picks.find((p) => p.materialId === "resin-standard")).toBeUndefined();
  });

  it("returns an empty list, with reasons, when nothing qualifies", () => {
    const r = recommendMaterials({ needs: { flexibility: 5, strength: 5, heatResistance: 5 } });
    expect(r.picks).toEqual([]);
    expect(r.ruledOut.length).toBeGreaterThan(0);
  });
});

describe("sampleWallThickness", () => {
  /** A hollow box: outer shell plus an inward-facing inner shell. */
  function hollowBox(size: number, wall: number): Float64Array {
    const outer = box(size, size, size);
    const inner = box(size - 2 * wall, size - 2 * wall, size - 2 * wall);
    for (let i = 0; i < inner.length; i += 3) {
      inner[i] += wall; inner[i + 1] += wall; inner[i + 2] += wall;
    }
    // Reverse winding so the cavity faces inward.
    for (let i = 0; i < inner.length; i += 9) {
      for (let c = 0; c < 3; c++) {
        const a = inner[i + 3 + c];
        inner[i + 3 + c] = inner[i + 6 + c];
        inner[i + 6 + c] = a;
      }
    }
    return new Float64Array([...outer, ...inner]);
  }

  it("measures a solid cube as its full width", () => {
    const w = sampleWallThickness(box(20, 20, 20))!;
    expect(w.medianMm).toBeCloseTo(20, 1);
  });

  it("measures the wall of a hollow box", () => {
    const w = sampleWallThickness(hollowBox(30, 1.5))!;
    expect(w.thinMm).toBeCloseTo(1.5, 1);
    expect(w.medianMm).toBeCloseTo(1.5, 1);
  });

  it("is repeatable", () => {
    const t = hollowBox(30, 1.5);
    expect(sampleWallThickness(t)!.medianMm).toBe(sampleWallThickness(t)!.medianMm);
  });

  it("judges walls against the process minimum", () => {
    const t = hollowBox(30, 0.4);
    const analysis = analyzeTriangles(t);
    const wall = sampleWallThickness(t);
    const facts = { bboxMm: analysis.bboxMm, analysis, wall, declaredUnit: "mm" as const };
    const fits = assessProcesses(facts, [
      { process: "SLS", minWallMm: 0.8, minDetailMm: 0.3, maxBuildMm: [700, 380, 580], materialCount: 1 },
      { process: "High-Detail SLM", minWallMm: 0.2, minDetailMm: 0.1, maxBuildMm: null, materialCount: 1 },
    ]);
    expect(fits[0].verdict).toBe("no");
    expect(fits[1].verdict).toBe("good");
  });
});
