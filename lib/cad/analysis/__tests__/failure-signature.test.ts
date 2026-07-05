import { describe, it, expect } from "vitest";

import {
  normalizeErrorSignature,
  clusterFailures,
  computeRepairEfficacy,
  type FailureRecord,
  type GenerationOutcome,
} from "../failure-signature";

describe("normalizeErrorSignature", () => {
  it("collapses volume/count numbers so instances cluster", () => {
    const a =
      "part contains 3 disconnected solids (volumes 812, 44, 12 mm^3) — every exported part must be one fused solid";
    const b =
      "part contains 7 disconnected solids (volumes 1024, 9 mm^3) — every exported part must be one fused solid";
    expect(normalizeErrorSignature(a)).toBe(normalizeErrorSignature(b));
  });

  it("collapses quoted identifiers in NameError-style messages", () => {
    expect(normalizeErrorSignature("name 'foo' is not defined")).toBe(
      normalizeErrorSignature("name 'bar_baz' is not defined")
    );
  });

  it("strips uuids and memory addresses", () => {
    const sig = normalizeErrorSignature(
      "object <Solid at 0x7fa19c3d> id 1f4d3c2b-1a2b-3c4d-5e6f-708192a3b4c5 failed"
    );
    expect(sig).toContain("<addr>");
    expect(sig).toContain("<id>");
    expect(sig).not.toMatch(/0x[0-9a-f]+/);
  });

  it("reduces a traceback to its final line", () => {
    const tb =
      'Traceback (most recent call last):\n  File "<generated>", line 12, in <module>\n    result = Box(1,2,3)\nValueError: dimensions must be positive';
    expect(normalizeErrorSignature(tb)).toBe(
      "valueerror: dimensions must be positive"
    );
  });

  it("returns empty for blank input", () => {
    expect(normalizeErrorSignature("")).toBe("");
    expect(normalizeErrorSignature("   ")).toBe("");
  });
});

describe("clusterFailures", () => {
  const rows: FailureRecord[] = [
    { id: "1", error: "name 'a' is not defined", sourceCode: "code a" },
    { id: "2", error: "name 'b' is not defined", sourceCode: "code b" },
    { id: "3", error: "name 'c' is not defined", sourceCode: "code c" },
    { id: "4", error: "fillet radius 2.5 too large", sourceCode: "code d" },
    { id: "5", error: "" },
  ];

  it("groups by signature and sorts by count desc", () => {
    const clusters = clusterFailures(rows);
    expect(clusters[0].count).toBe(3); // the NameError cluster
    expect(clusters[0].signature).toContain("not defined");
    expect(clusters.some((c) => c.signature.includes("fillet"))).toBe(true);
  });

  it("ignores empty errors", () => {
    const clusters = clusterFailures(rows);
    const total = clusters.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(4);
  });

  it("respects minCount", () => {
    const clusters = clusterFailures(rows, { minCount: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
  });

  it("caps examples per cluster", () => {
    const clusters = clusterFailures(rows, { maxExamples: 2 });
    const nameCluster = clusters.find((c) => c.signature.includes("not defined"));
    expect(nameCluster?.examples).toHaveLength(2);
  });
});

describe("computeRepairEfficacy", () => {
  it("counts a failure as repaired when a child succeeded", () => {
    const gens: GenerationOutcome[] = [
      { id: "root", status: "failed", error: "fillet radius 2 too large" },
      { id: "fix", parentGenerationId: "root", status: "succeeded" },
      { id: "root2", status: "failed", error: "fillet radius 9 too large" },
      { id: "fix2", parentGenerationId: "root2", status: "failed", error: "x" },
    ];
    const eff = computeRepairEfficacy(gens);
    const filletSig = eff.find((e) => e.signature.includes("fillet"));
    expect(filletSig).toBeDefined();
    expect(filletSig?.attempts).toBe(2);
    expect(filletSig?.repaired).toBe(1);
    expect(filletSig?.rate).toBeCloseTo(0.5);
  });

  it("excludes failures with no follow-up attempt", () => {
    const gens: GenerationOutcome[] = [
      { id: "root", status: "failed", error: "abandoned failure" },
    ];
    expect(computeRepairEfficacy(gens)).toHaveLength(0);
  });
});
