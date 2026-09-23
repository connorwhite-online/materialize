import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

const completeText = vi.fn();
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...a: unknown[]) => completeText(...a),
  hasModelCredentials: () => true,
}));
const runCadCode = vi.fn();
vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...a: unknown[]) => runCadCode(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  blockoutCandidates,
  blockoutProblem,
  briefSpans,
  isContainerPrompt,
  CONCEPT_BLOCKOUT_LABEL,
} from "@/lib/cad/concept-blockout";

function run(over: Partial<CadRunResult> = {}, dims = { x: 60, y: 40, z: 30 }): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: dims },
    validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true, bodyCount: 1 },
    renders: { threeQuarter: "PNG" },
    ...over,
  };
}

const dirs = [
  { label: "Soft", detail: "a" },
  { label: "Crisp", detail: "b" },
  { label: "Bold", detail: "c" },
];

describe("blockoutProblem", () => {
  it("accepts one watertight body at a sane size", () => {
    expect(blockoutProblem(run(), [])).toBeNull();
  });

  it("rejects failed builds, multiple bodies and degenerate slivers", () => {
    expect(blockoutProblem(run({ ok: false, error: "boom" }), [])).toBe("boom");
    expect(
      blockoutProblem(run({ validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true, bodyCount: 3 } }), [])
    ).toMatch(/ONE connected body/);
    // the "2 x 1 x 23mm enclosure" from the experiment would pass by size
    // alone, so degenerate means the LARGEST extent is tiny
    expect(blockoutProblem(run({}, { x: 2, y: 1, z: 4 }), [])).toMatch(/degenerate/);
  });

  it("checks size against the brief's spans, ignoring orientation", () => {
    // brief says 60 x 40 x 30; a blockout lying on its side is fine
    expect(blockoutProblem(run({}, { x: 30, y: 60, z: 40 }), [60, 40, 30])).toBeNull();
    // a 213mm shovel when the brief asks for 170
    expect(blockoutProblem(run({}, { x: 213, y: 100, z: 60 }), [170, 96, 68])).toMatch(/overall size is off/);
  });
});

describe("container check", () => {
  it("rejects a container that came back solid, only for containers", () => {
    // the closed "organizer" pill: 0.72 of its box
    const solid = run({ geometry: { dimensions: { x: 180, y: 100, z: 60 }, volume: 777_600 } });
    expect(blockoutProblem(solid, [], { container: true })).toMatch(/solid block \(fills 72%/);
    expect(blockoutProblem(solid, [])).toBeNull();
    // an open organizer: 0.42
    const open = run({ geometry: { dimensions: { x: 252, y: 80, z: 61 }, volume: 516_000 } });
    expect(blockoutProblem(open, [], { container: true })).toBeNull();
  });

  it("prefers the sidecar's opening check, which catches sealed hollows", () => {
    // a sealed hollow is mostly empty, so fill alone passes it (0.28)...
    const hollow = run({
      geometry: { dimensions: { x: 180, y: 53, z: 57 }, volume: 152_000 },
      checks: { opening: { openFraction: 0.001 } },
    });
    expect(blockoutProblem(hollow, [], { container: true })).toMatch(/does not open from above/);
    // ...and a real organizer passes even when it is fairly full
    const open = run({
      geometry: { dimensions: { x: 180, y: 100, z: 60 }, volume: 700_000 },
      checks: { opening: { openFraction: 0.52 } },
    });
    expect(blockoutProblem(open, [], { container: true })).toBeNull();
  });

  it("asks the sidecar for the opening check only for containers", async () => {
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(run());
    await blockoutCandidates({ prompt: "a desk organizer", directions: dirs.slice(0, 1) });
    expect(runCadCode.mock.calls[0][3]).toEqual({ engine: "mesh", checks: { opening: {} } });
    runCadCode.mockClear();
    await blockoutCandidates({ prompt: "a knob", directions: dirs.slice(0, 1) });
    expect(runCadCode.mock.calls[0][3]).toEqual({ engine: "mesh" });
  });

  it("recognizes containers, not enclosures", () => {
    expect(isContainerPrompt("A desk organizer with three compartments")).toBe(true);
    expect(isContainerPrompt("a planter for succulents")).toBe(true);
    expect(isContainerPrompt("an enclosure for an ESP32")).toBe(false);
  });
});

describe("briefSpans", () => {
  it("reads only bbox_span targets", () => {
    expect(
      briefSpans({
        dimensionTargets: [
          { label: "len", kind: "bbox_span", axis: "x", value: 55 },
          { label: "bore", kind: "diameter", value: 6 },
        ],
      } as never)
    ).toEqual([55]);
    expect(briefSpans(null)).toEqual([]);
  });
});

describe("blockoutCandidates", () => {
  beforeEach(() => {
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(run());
  });

  it("returns one labelled candidate per direction that builds", async () => {
    const out = await blockoutCandidates({ prompt: "a knob", directions: dirs });
    expect(out).toHaveLength(3);
    expect(out[0].img).toEqual({ data: "PNG", mediaType: "image/png", label: CONCEPT_BLOCKOUT_LABEL });
    expect(out[0].code).toBe("result = 1");
    // specks are dropped for the picture, but the seed code stays the model's
    expect(runCadCode.mock.calls[0][0]).toContain("largest_body(result)");
    expect(runCadCode.mock.calls[0][0]).toContain("except NameError");
    // runs on the mesh engine, STL only
    expect(runCadCode.mock.calls[0][3]).toEqual({ engine: "mesh" });
  });

  it("retries a failed direction once, telling the model what went wrong", async () => {
    runCadCode
      .mockResolvedValueOnce(run({ ok: false, error: "TypeError: bad call" }))
      .mockResolvedValue(run());
    const out = await blockoutCandidates({ prompt: "a knob", directions: dirs.slice(0, 1) });
    expect(out).toHaveLength(1);
    expect(completeText).toHaveBeenCalledTimes(2);
    expect(completeText.mock.calls[1][0].prompt).toContain("TypeError: bad call");
  });

  it("drops a direction that fails twice", async () => {
    runCadCode.mockResolvedValue(run({ ok: false, error: "nope" }));
    const out = await blockoutCandidates({ prompt: "a knob", directions: dirs.slice(0, 2) });
    expect(out).toEqual([]);
  });

  it("uses a fast model with its own usage role", async () => {
    await blockoutCandidates({ prompt: "a knob", directions: dirs.slice(0, 1) });
    expect(completeText.mock.calls[0][0]).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      role: "concept-blockout",
    });
  });
});
