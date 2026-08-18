import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Feature-chip accumulation across the agentic session (the chips fix).
 *
 * The sidecar resets its op log on every session exec, so each exec's payload
 * carries only THAT step's ops — and the loop used to ship whichever single
 * exec happened to grade pass last, losing every earlier op (chips never
 * appeared in production, where agentic is the default route). These tests
 * script the model + session and assert the loop now:
 *   - accumulates every exec's features, rebasing spans onto the assembled
 *     transcript so statement edits splice the right lines;
 *   - keeps faceIds only for the exec whose topo actually ships (bestRun);
 *   - collects ops from run-less execs (a Hole in a sketch-only step);
 *   - discards ops rolled back with the geometry.
 */

const createMock = vi.fn<
  (
    body: Record<string, unknown>,
    opts?: unknown
  ) => Promise<Partial<Anthropic.Message>>
>();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: Parameters<typeof createMock>) => createMock(...args),
    };
  },
}));

const execMock = vi.fn();

vi.mock("@/lib/cad/session-client", () => ({
  createSession: vi.fn(async () => "sess-1"),
  deleteSession: vi.fn(async () => undefined),
  execInSession: (...args: unknown[]) => execMock(...args),
  // Real narrowing logic — the run/no-run split is what's under test.
  execProducedRun: (r: Record<string, unknown>) => "validation" in r,
  importStepIntoSession: vi.fn(),
  rollbackSession: vi.fn(async () => true),
  snapshotSession: vi.fn(async () => true),
  CadSessionError: class CadSessionError extends Error {},
}));

vi.mock("@/lib/storage", () => ({ getObjectBytes: vi.fn() }));
vi.mock("@/lib/cad/critique", () => ({
  judgeAesthetics: vi.fn(async () => ({ available: false })),
}));
vi.mock("@/lib/cad/step-parts", () => ({
  sourcePart: vi.fn(),
  catalogEnabled: () => false,
}));

import { runAgenticHarness } from "@/lib/cad/agentic";

const savedKey = process.env.ANTHROPIC_API_KEY;

function toolUse(name: string, input: Record<string, unknown>): Partial<Anthropic.Message> {
  return {
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        id: `tu-${createMock.mock.calls.length}`,
        name,
        input,
        caller: { type: "direct" },
      } as unknown as Anthropic.ToolUseBlock,
    ],
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
  };
}

/** A session exec payload that grades pass, carrying that exec's ops. */
function passingRun(features: unknown[]) {
  return {
    ok: true,
    files: { stl: "c3Rs" },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
    geometry: { dimensions: { x: 10, y: 10, z: 10 } },
    features,
    stdout: "",
    namespace: ["result"],
  };
}

beforeEach(() => {
  createMock.mockReset();
  execMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  // The loop builds its own brief on a fresh build; these tests script the
  // model turn-by-turn and aren't about the brief, so skip that model call
  // rather than letting it consume a scripted response.
  process.env.CAD_BRIEF_STEP = "false";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  delete process.env.CAD_BRIEF_STEP;
});

describe("agentic feature accumulation", () => {
  it("accumulates every exec's ops with spans rebased onto the assembled source", async () => {
    const code1 = "from build123d import *\nresult = Box(10, 10, 10)";
    const code2 = "result = fillet(result.edges(), radius=2)";
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: code1 }))
      .mockResolvedValueOnce(toolUse("exec", { code: code2 }))
      .mockResolvedValueOnce(toolUse("finish", {}));
    execMock
      .mockResolvedValueOnce(
        passingRun([
          {
            id: "extrude-0",
            op: "extrude",
            label: "Extrude 10",
            params: { amount: 10 },
            faceIds: [1, 2],
            span: [2, 2],
          },
        ])
      )
      .mockResolvedValueOnce(
        passingRun([
          {
            id: "fillet-0",
            op: "fillet",
            label: "Fillet r=2",
            params: { radius: 2 },
            faceIds: [7],
            span: [1, 1],
          },
        ])
      );

    const result = await runAgenticHarness({ prompt: "a filleted cube" });

    expect(result.ok).toBe(true);
    const features = result.run?.features ?? [];
    expect(features).toHaveLength(2);

    // Ids are step-prefixed so per-exec counters can't collide.
    expect(features.map((f) => f.id)).toEqual(["s1-extrude-0", "s2-fillet-0"]);

    // faceIds survive ONLY for the exec whose topo ships with bestRun.
    expect(features[0].faceIds).toEqual([]);
    expect(features[1].faceIds).toEqual([7]);

    // Spans resolve against the persisted transcript: the rebased line must
    // BE the statement the op came from, whatever the banner format is.
    const lines = result.sourceCode.split("\n");
    expect(lines[features[0].span![0] - 1]).toBe("result = Box(10, 10, 10)");
    expect(lines[features[1].span![0] - 1]).toBe(code2);
  });

  it("collects ops from a run-less exec (sketch-only step) once a later exec passes", async () => {
    const sketch = "with BuildSketch() as sk:\n    Hole(3)";
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: sketch }))
      .mockResolvedValueOnce(toolUse("exec", { code: "result = part" }))
      .mockResolvedValueOnce(toolUse("finish", {}));
    execMock
      // Plain reply — no run yet, but the new sidecar reports the ops.
      .mockResolvedValueOnce({
        ok: true,
        stdout: "",
        namespace: ["sk"],
        features: [
          {
            id: "hole-0",
            op: "hole",
            label: "Hole r=3",
            params: { radius: 3 },
            faceIds: [],
            span: [2, 2],
          },
        ],
      })
      .mockResolvedValueOnce(passingRun([]));

    const result = await runAgenticHarness({ prompt: "a plate with a hole" });

    const features = result.run?.features ?? [];
    expect(features.map((f) => f.id)).toEqual(["s1-hole-0"]);
    const lines = result.sourceCode.split("\n");
    expect(lines[features[0].span![0] - 1]).toBe("    Hole(3)");
  });

  it("drops ops recorded after a snapshot when the model rolls back", async () => {
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = base()" }))
      .mockResolvedValueOnce(toolUse("snapshot", {}))
      .mockResolvedValueOnce(toolUse("exec", { code: "result = fillet(result, radius=9)" }))
      .mockResolvedValueOnce(toolUse("rollback", {}))
      .mockResolvedValueOnce(toolUse("exec", { code: "result = chamfer(result, length=1)" }))
      .mockResolvedValueOnce(toolUse("finish", {}));
    execMock
      .mockResolvedValueOnce(
        passingRun([
          { id: "extrude-0", op: "extrude", label: "Extrude 5", params: { amount: 5 }, faceIds: [1], span: [1, 1] },
        ])
      )
      .mockResolvedValueOnce(
        passingRun([
          { id: "fillet-0", op: "fillet", label: "Fillet r=9", params: { radius: 9 }, faceIds: [2], span: [1, 1] },
        ])
      )
      .mockResolvedValueOnce(
        passingRun([
          { id: "chamfer-0", op: "chamfer", label: "Chamfer l=1", params: { length: 1 }, faceIds: [3], span: [1, 1] },
        ])
      );

    const result = await runAgenticHarness({ prompt: "a chamfered base" });

    // The rolled-back fillet is not in the shipped geometry — no chip for it.
    const features = result.run?.features ?? [];
    expect(features.map((f) => f.id)).toEqual(["s1-extrude-0", "s3-chamfer-0"]);
    expect(features[1].faceIds).toEqual([3]);
  });

  it("tolerates an old sidecar that sends no per-exec features", async () => {
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = base()" }))
      .mockResolvedValueOnce(toolUse("finish", {}));
    execMock.mockResolvedValueOnce(passingRun([]));

    const result = await runAgenticHarness({ prompt: "a cube" });
    expect(result.ok).toBe(true);
    // No synthetic features invented; the run's own (absent) list stands.
    expect(result.run?.features ?? []).toEqual([]);
  });
});
