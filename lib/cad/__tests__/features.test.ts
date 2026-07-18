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
