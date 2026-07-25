import { describe, expect, it } from "vitest";

import {
  bindFeatureParamNames,
  featureParamsToSourceParams,
  parseFeatures,
  positionsForTriangleRanges,
  triangleRangesForFaceIds,
} from "@/lib/cad/features";
import type { CadFeature } from "@/lib/cad/types";
import type { CadTopology } from "@/components/viewer/topology";

const sample: CadFeature[] = [
  {
    id: "fillet-0",
    op: "fillet",
    label: "Fillet r=2.4",
    params: { radius: 2.4 },
    faceIds: [3, 4],
  },
  {
    id: "extrude-0",
    op: "extrude",
    label: "Extrude 12",
    params: { amount: 12 },
    faceIds: [],
  },
];

describe("parseFeatures", () => {
  it("accepts a well-formed sidecar payload", () => {
    expect(parseFeatures(sample)).toEqual(sample);
  });

  it("drops malformed entries and fails open on garbage", () => {
    expect(parseFeatures(null)).toEqual([]);
    expect(parseFeatures("nope")).toEqual([]);
    expect(
      parseFeatures([
        { id: "x", op: "fillet", label: "ok", params: { radius: 1 }, faceIds: [0] },
        { id: "bad", op: "not-an-op", label: "x", params: {}, faceIds: [] },
        { id: "", op: "fillet", label: "x", params: {}, faceIds: [] },
      ])
    ).toEqual([
      {
        id: "x",
        op: "fillet",
        label: "ok",
        params: { radius: 1 },
        faceIds: [0],
      },
    ]);
  });
});

describe("bindFeatureParamNames", () => {
  it("binds uniquely-matching top-level source params", () => {
    const src = "wall = 2\nfillet_r = 2.4\nheight = 12\n";
    const bound = bindFeatureParamNames(sample, src);
    expect(bound[0].paramNames).toEqual({ radius: "fillet_r" });
    expect(bound[1].paramNames).toEqual({ amount: "height" });
  });

  it("leaves ambiguous values unbound", () => {
    const src = "a = 2.4\nb = 2.4\n";
    const bound = bindFeatureParamNames(sample, src);
    expect(bound[0].paramNames).toBeUndefined();
  });

  it("preserves existing paramNames", () => {
    const withNames: CadFeature[] = [
      {
        ...sample[0],
        paramNames: { radius: "custom_r" },
      },
    ];
    const bound = bindFeatureParamNames(
      withNames,
      "fillet_r = 2.4\ncustom_r = 9\n"
    );
    expect(bound[0].paramNames).toEqual({ radius: "custom_r" });
  });
});

describe("featureParamsToSourceParams", () => {
  it("maps draft control keys through paramNames", () => {
    const f: CadFeature = {
      ...sample[0],
      paramNames: { radius: "fillet_r" },
    };
    expect(featureParamsToSourceParams(f, { radius: 3.1 })).toEqual({
      fillet_r: 3.1,
    });
  });

  it("ignores unbound keys", () => {
    expect(featureParamsToSourceParams(sample[0], { radius: 3 })).toEqual({});
  });
});

describe("triangleRangesForFaceIds + positionsForTriangleRanges", () => {
  const topo: CadTopology = {
    faces: [
      { id: 0, surface: "plane", params: null, triRange: [0, 2] },
      { id: 1, surface: "cylinder", params: null, triRange: [2, 5] },
      { id: 2, surface: "plane", params: null, triRange: [5, 6] },
    ],
    edges: [],
  };

  it("collects triRanges for the requested face ids", () => {
    expect(triangleRangesForFaceIds(topo, [1, 2])).toEqual([
      [2, 5],
      [5, 6],
    ]);
    expect(triangleRangesForFaceIds(topo, [])).toEqual([]);
  });

  it("builds a flat position array from ranges", () => {
    // 6 triangles × 3 verts × 3 coords — fill with sequential numbers.
    const position = Float32Array.from({ length: 6 * 3 * 3 }, (_, i) => i);
    const ranges = triangleRangesForFaceIds(topo, [0]);
    const out = positionsForTriangleRanges(position, null, 6, ranges);
    // Face 0 → tris 0..2 → 2 tris × 3 verts × 3 = 18 numbers, starting at 0.
    expect(out).toHaveLength(18);
    expect(out[0]).toBe(0);
    expect(out[17]).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// Statement-span editing (MTR-225)
// ---------------------------------------------------------------------------

import {
  editableFeatureKeys,
  spanText,
  spliceStatementSpan,
  substituteFeatureParams,
} from "@/lib/cad/features";

const SPAN_SOURCE = [
  "from build123d import *", // 1
  "wall = 2.4", // 2
  "with BuildPart() as p:", // 3
  "    Box(20, 20, 10)", // 4
  "    fillet(p.edges().group_by(Axis.Z)[-1], 3.5)", // 5
  "result = p.part", // 6
].join("\n");

const spanFeature: CadFeature = {
  id: "fillet-0",
  op: "fillet",
  label: "Fillet r=3.5",
  params: { radius: 3.5 },
  faceIds: [],
  span: [5, 5],
};

describe("parseFeatures span (MTR-225)", () => {
  it("keeps a well-formed span and drops malformed ones", () => {
    const [ok] = parseFeatures([{ ...spanFeature }]);
    expect(ok.span).toEqual([5, 5]);
    const [bad] = parseFeatures([{ ...spanFeature, span: [5] }]);
    expect(bad.span).toBeUndefined();
    const [inverted] = parseFeatures([{ ...spanFeature, span: [6, 5] }]);
    expect(inverted.span).toBeUndefined();
    const [zero] = parseFeatures([{ ...spanFeature, span: [0, 5] }]);
    expect(zero.span).toBeUndefined();
  });
});

describe("spanText", () => {
  it("returns the 1-based inclusive line range", () => {
    expect(spanText(SPAN_SOURCE, [5, 5])).toContain("fillet(");
    expect(spanText(SPAN_SOURCE, [2, 3])).toBe(
      "wall = 2.4\nwith BuildPart() as p:"
    );
  });
  it("rejects out-of-range spans", () => {
    expect(spanText(SPAN_SOURCE, [1, 99])).toBeNull();
  });
});

describe("editableFeatureKeys", () => {
  it("includes name-bound keys", () => {
    const f: CadFeature = {
      ...spanFeature,
      paramNames: { radius: "fillet_r" },
      span: undefined,
    };
    expect(editableFeatureKeys(f, SPAN_SOURCE)).toEqual(new Set(["radius"]));
  });

  it("includes a key whose value appears exactly once in the span", () => {
    expect(editableFeatureKeys(spanFeature, SPAN_SOURCE)).toEqual(
      new Set(["radius"])
    );
  });

  it("honesty rail: ambiguous literals in the span stay non-editable", () => {
    const src = SPAN_SOURCE.replace(
      "fillet(p.edges().group_by(Axis.Z)[-1], 3.5)",
      "chamfer(p.edges(), 3.5, 3.5)"
    );
    const f: CadFeature = { ...spanFeature, params: { length: 3.5 } };
    expect(editableFeatureKeys(f, src).size).toBe(0);
  });

  it("does not match a literal inside a longer number", () => {
    const src = SPAN_SOURCE.replace("3.5)", "13.5)");
    const f: CadFeature = { ...spanFeature, params: { radius: 3.5 } };
    expect(editableFeatureKeys(f, src).size).toBe(0);
  });
});

describe("substituteFeatureParams", () => {
  it("rewrites a span literal in place", () => {
    const out = substituteFeatureParams(SPAN_SOURCE, spanFeature, {
      radius: 4.25,
    });
    expect(out).not.toBeNull();
    expect(out!.applied).toEqual(["radius"]);
    expect(out!.source).toContain("fillet(p.edges().group_by(Axis.Z)[-1], 4.25)");
    // Everything outside the span is untouched.
    expect(out!.source).toContain("wall = 2.4");
    expect(out!.source.split("\n")).toHaveLength(6);
  });

  it("routes name-bound keys through the top-level assignment", () => {
    const f: CadFeature = {
      id: "shell-0",
      op: "shell",
      label: "Shell 2.4",
      params: { amount: 2.4 },
      paramNames: { amount: "wall" },
      faceIds: [],
    };
    const out = substituteFeatureParams(SPAN_SOURCE, f, { amount: 3 });
    expect(out).not.toBeNull();
    expect(out!.source).toContain("wall = 3");
    expect(out!.applied).toEqual(["amount"]);
  });

  it("returns null for unchanged or non-editable drafts", () => {
    expect(
      substituteFeatureParams(SPAN_SOURCE, spanFeature, { radius: 3.5 })
    ).toBeNull();
    const noSpan: CadFeature = { ...spanFeature, span: undefined };
    expect(
      substituteFeatureParams(SPAN_SOURCE, noSpan, { radius: 4 })
    ).toBeNull();
  });
});

describe("spliceStatementSpan", () => {
  it("replaces the span and re-indents a dedented replacement", () => {
    const out = spliceStatementSpan(
      SPAN_SOURCE,
      [5, 5],
      "fillet(p.edges().group_by(Axis.Z)[-1], 5)"
    );
    expect(out).toContain("    fillet(p.edges().group_by(Axis.Z)[-1], 5)");
    expect(out!.split("\n")).toHaveLength(6);
  });

  it("keeps replacement indentation when the model preserved it", () => {
    const out = spliceStatementSpan(
      SPAN_SOURCE,
      [5, 5],
      "    top = p.edges().group_by(Axis.Z)[-1]\n    fillet(top, 5)"
    );
    expect(out!.split("\n")[4]).toBe("    top = p.edges().group_by(Axis.Z)[-1]");
    expect(out!.split("\n")[5]).toBe("    fillet(top, 5)");
    expect(out!.split("\n")).toHaveLength(7);
  });

  it("rejects empty replacements and bad spans", () => {
    expect(spliceStatementSpan(SPAN_SOURCE, [5, 5], "   \n")).toBeNull();
    expect(spliceStatementSpan(SPAN_SOURCE, [0, 5], "x = 1")).toBeNull();
  });
});
