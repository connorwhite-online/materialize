import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The finish() gate, and the brief that gives it something to check.
 *
 * Before this, `finish()` set a flag and exported whatever `result` held —
 * nothing verified the part that was about to ship — and the loop read
 * dimension targets ONLY from a caller-threaded brief, which the orchestrate
 * path never sends. So on the route that handles our hardest parts, the
 * MTR-197 dimension contract checked nothing and "done" was purely the
 * model's own say-so: the mechanical half of "quits early and simplifies".
 *
 * These tests script the model + session and assert the loop now:
 *   - builds its own brief on a fresh build and holds the part to it;
 *   - refuses finish() while the shipped run misses that contract, naming
 *     what's outstanding;
 *   - honors finish() after MAX_FINISH_REFUSALS so the gate can't lose the
 *     part to a budget spent arguing;
 *   - never blocks on a check that did not RUN (honesty rail, MTR-199);
 *   - leaves a revision's brief alone (no new contract mid-thread).
 */

const createMock = vi.fn<
  (
    body: Record<string, unknown>,
    opts?: unknown
  ) => Promise<Partial<Anthropic.Message>>
>();

// Both entry points funnel into ONE spy: model-client's completeText calls
// `create`, the agentic loop streams (long thinking turns would otherwise trip
// the non-streaming request timeout). The request body is identical either
// way, so every assertion on createMock.mock.calls[n][0] still reads the real
// request — and call ordering across the two paths stays observable.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: Parameters<typeof createMock>) => createMock(...args),
      stream: (...args: Parameters<typeof createMock>) => ({
        finalMessage: () => createMock(...args),
      }),
    };
  },
}));

const execMock = vi.fn();

vi.mock("@/lib/cad/session-client", () => ({
  createSession: vi.fn(async () => "sess-1"),
  deleteSession: vi.fn(async () => undefined),
  execInSession: (...args: unknown[]) => execMock(...args),
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

// Only the model call is faked — the schema, the prompt formatter, and the
// check machinery stay real so the test exercises the shipped contract.
const buildBriefMock = vi.fn();
vi.mock("@/lib/cad/brief", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cad/brief")>()),
  buildBrief: (...args: unknown[]) => buildBriefMock(...args),
}));

import { runAgenticHarness } from "@/lib/cad/agentic";

const savedKey = process.env.ANTHROPIC_API_KEY;

function toolUse(
  name: string,
  input: Record<string, unknown> = {}
): Partial<Anthropic.Message> {
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

/** A session exec payload that passes the structural grade at the given size. */
function passingRun(dims: { x: number; y: number; z: number }) {
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
    geometry: { dimensions: dims },
    stdout: "",
    namespace: ["result"],
  };
}

function briefWith(targets: unknown[]) {
  return {
    v: 1 as const,
    part: "a 40x40x50 riser",
    dimensionTargets: targets,
    components: [],
    interfaces: [],
    keepOut: [],
  };
}

/** Text of the tool_result blocks in the newest user turn of a model call. */
function toolResultText(callIndex: number): string {
  const body = createMock.mock.calls[callIndex][0] as {
    messages: Anthropic.MessageParam[];
  };
  const last = body.messages[body.messages.length - 1];
  if (!Array.isArray(last.content)) return "";
  return last.content
    .flatMap((block) =>
      block.type === "tool_result" && Array.isArray(block.content)
        ? block.content.filter((c) => c.type === "text").map((c) => c.text)
        : []
    )
    .join("\n");
}

/** The task prompt text of the first user turn. */
function taskPrompt(): string {
  const body = createMock.mock.calls[0][0] as {
    messages: Anthropic.MessageParam[];
  };
  const content = body.messages[0].content;
  if (!Array.isArray(content)) return String(content);
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

const BASE_INPUT = { prompt: "a 50mm tall riser block" };

beforeEach(() => {
  createMock.mockReset();
  execMock.mockReset();
  buildBriefMock.mockReset().mockResolvedValue(null);
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  delete process.env.CAD_BRIEF_STEP;
});

describe("agentic finish() gate", () => {
  it("builds its own brief on a fresh build and shows it to the agent", async () => {
    buildBriefMock.mockResolvedValue(
      briefWith([
        { label: "overall height", kind: "bbox_span", axis: "z", value: 50, tolerance: 0.5 },
      ])
    );
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"));

    const result = await runAgenticHarness(BASE_INPUT);

    expect(buildBriefMock).toHaveBeenCalledOnce();
    // The contract the gate enforces must be visible to the agent, or it gets
    // refused over numbers it was never told.
    expect(taskPrompt()).toContain("overall height");
    // …and it must ride the result, or a fresh agentic build persists no brief.
    expect(result.brief).toMatchObject({ part: "a 40x40x50 riser" });
  });

  it("refuses finish() while the shipped part misses the dimension contract", async () => {
    buildBriefMock.mockResolvedValue(
      briefWith([
        { label: "overall height", kind: "bbox_span", axis: "z", value: 50, tolerance: 0.5 },
      ])
    );
    // 20mm tall: structurally valid, and 30mm short of the brief.
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 20 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"));

    const result = await runAgenticHarness(BASE_INPUT);

    // The first two finishes came back as refusals naming the failure…
    const firstRefusal = toolResultText(2);
    expect(firstRefusal).toContain('"finished":false');
    expect(firstRefusal).toContain("overall height");
    expect(firstRefusal).toContain("dimension contract");
    expect(toolResultText(3)).toContain('"finished":false');
    // …and the loop kept running instead of ending on the first finish().
    expect(createMock).toHaveBeenCalledTimes(4);
    // Third finish is honored — the gate never costs us the part.
    expect(result.ok).toBe(true);
    expect(result.dimensionChecks?.some((c) => c.ran && c.ok === false)).toBe(true);
  });

  it("accepts finish() immediately when the contract is met", async () => {
    buildBriefMock.mockResolvedValue(
      briefWith([
        { label: "overall height", kind: "bbox_span", axis: "z", value: 50, tolerance: 0.5 },
      ])
    );
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"));

    const result = await runAgenticHarness(BASE_INPUT);

    // Two calls only: the loop ended on the first finish().
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("never blocks on a check that did not run", async () => {
    // A diameter target needs the B-rep topology manifest; this run has none,
    // so the check reports not-run — which must not read as a failure.
    buildBriefMock.mockResolvedValue(
      briefWith([{ label: "bore diameter", kind: "diameter", value: 8, tolerance: 0.2 }])
    );
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"));

    const result = await runAgenticHarness(BASE_INPUT);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("refuses finish() when no solid has been produced at all", async () => {
    createMock
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"))
      .mockResolvedValueOnce(toolUse("finish"));

    await runAgenticHarness(BASE_INPUT);

    expect(toolResultText(1)).toContain("no solid has been produced yet");
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("does not mint a new brief for a revision", async () => {
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"));

    await runAgenticHarness({
      ...BASE_INPUT,
      priorSourceCode: "result = Box(40, 40, 50)",
    });

    // A revision honors the original contract or none — inventing one
    // mid-thread would hold turn 2 to numbers turn 1 never agreed to.
    expect(buildBriefMock).not.toHaveBeenCalled();
  });

  it("prefers a caller-threaded brief over building one", async () => {
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"));

    await runAgenticHarness({
      ...BASE_INPUT,
      providedBrief: briefWith([
        { label: "overall height", kind: "bbox_span", axis: "z", value: 50 },
      ]),
    });

    expect(buildBriefMock).not.toHaveBeenCalled();
    // The composer's brief used to be invisible to this loop entirely.
    expect(taskPrompt()).toContain("overall height");
  });

  it("skips the brief step when CAD_BRIEF_STEP=false", async () => {
    process.env.CAD_BRIEF_STEP = "false";
    execMock.mockResolvedValue(passingRun({ x: 40, y: 40, z: 50 }));
    createMock
      .mockResolvedValueOnce(toolUse("exec", { code: "result = 1" }))
      .mockResolvedValueOnce(toolUse("finish"));

    await runAgenticHarness(BASE_INPUT);

    expect(buildBriefMock).not.toHaveBeenCalled();
  });
});
