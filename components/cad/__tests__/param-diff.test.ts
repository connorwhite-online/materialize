import { describe, it, expect } from "vitest";
import { extractParams, diffParams } from "@/components/cad/param-diff";

describe("extractParams", () => {
  it("parses plain top-level numeric assignments", () => {
    const src = [
      "from build123d import *",
      "",
      "wall = 2",
      "corner_r = 6",
      "height = 40.5",
    ].join("\n");
    expect(extractParams(src)).toEqual({ wall: 2, corner_r: 6, height: 40.5 });
  });

  it("parses tuple unpacking (a, b, c = 1, 2, 3)", () => {
    const src = "length, width, height = 60, 40, 12\n";
    expect(extractParams(src)).toEqual({ length: 60, width: 40, height: 12 });
  });

  it("skips tuple assignments whose name/value counts mismatch", () => {
    expect(extractParams("a, b = 1, 2, 3\nx = 1, 2\n")).toEqual({});
  });

  it("parses floats, negatives, leading-dot, and exponent forms", () => {
    const src = [
      "offset = -3.5",
      "tol = .2",
      "big = 1.5e2",
      "neg_exp = -2E-1",
      "plus = +4",
    ].join("\n");
    expect(extractParams(src)).toEqual({
      offset: -3.5,
      tol: 0.2,
      big: 150,
      neg_exp: -0.2,
      plus: 4,
    });
  });

  it("ignores indented lines (not top-level)", () => {
    const src = [
      "wall = 2",
      "def make():",
      "    inner = 5",
      "\tdepth = 9",
      "  spaced = 1.5",
    ].join("\n");
    expect(extractParams(src)).toEqual({ wall: 2 });
  });

  it("ignores comment lines and honors trailing comments", () => {
    const src = [
      "# wall = 99",
      "wall = 2  # mm, printable minimum",
      "corner_r = 8 # was 6",
    ].join("\n");
    expect(extractParams(src)).toEqual({ wall: 2, corner_r: 8 });
  });

  it("ignores string assignments and non-numeric expressions", () => {
    const src = [
      'name = "bracket"',
      "label = '2'",
      "computed = wall * 2",
      "size = max(3, 4)",
      "flag == 3",
      "wall = 2",
    ].join("\n");
    expect(extractParams(src)).toEqual({ wall: 2 });
  });

  it("keeps the last value when a name is reassigned", () => {
    expect(extractParams("wall = 2\nwall = 3\n")).toEqual({ wall: 3 });
  });

  it("returns empty for mesh-mode scripts with no parameter block", () => {
    const src = [
      "from build123d import *",
      "with BuildPart() as part:",
      "    Box(10, 10, 10)",
      "result = part.part",
    ].join("\n");
    expect(extractParams(src)).toEqual({});
  });

  it("returns empty for empty source", () => {
    expect(extractParams("")).toEqual({});
  });
});

describe("diffParams", () => {
  it("categorizes changed, added, and removed parameters", () => {
    const prev = { wall: 2, corner_r: 6, depth: 9 };
    const next = { wall: 2.4, corner_r: 8, lid_h: 4 };
    expect(diffParams(prev, next)).toEqual({
      changed: [
        ["wall", 2, 2.4],
        ["corner_r", 6, 8],
      ],
      added: [["lid_h", 4]],
      removed: [["depth", 9]],
    });
  });

  it("reports no differences for identical sets", () => {
    const params = { wall: 2, corner_r: 6 };
    expect(diffParams(params, { ...params })).toEqual({
      changed: [],
      added: [],
      removed: [],
    });
  });

  it("treats everything as added/removed against an empty side", () => {
    expect(diffParams({}, { wall: 2 })).toEqual({
      changed: [],
      added: [["wall", 2]],
      removed: [],
    });
    expect(diffParams({ wall: 2 }, {})).toEqual({
      changed: [],
      added: [],
      removed: [["wall", 2]],
    });
  });
});
