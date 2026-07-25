import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Prompt caching (MTR-221): both model call sites must mark the invariant
 * prefix with cache_control breakpoints, and the agentic loop must place a
 * MOVING breakpoint on the newest tool_result turn without accumulating
 * markers past the API's 4-per-request budget. The mocked SDK captures the
 * raw request bodies so these tests assert the wire shape directly.
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

vi.mock("@/lib/cad/session-client", () => ({
  createSession: vi.fn(async () => "sess-1"),
  deleteSession: vi.fn(async () => undefined),
  execInSession: vi.fn(),
  execProducedRun: vi.fn(() => false),
  importStepIntoSession: vi.fn(),
  rollbackSession: vi.fn(async () => undefined),
  snapshotSession: vi.fn(async () => undefined),
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

import { completeText } from "@/lib/cad/model-client";
import { runAgenticHarness } from "@/lib/cad/agentic";
import { CadMeter, runWithCadContext } from "@/lib/cad/metering";

const savedKey = process.env.ANTHROPIC_API_KEY;

function textTurn(text: string): Partial<Anthropic.Message> {
  return {
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    content: [{ type: "text", text, citations: null }],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 60,
    } as Anthropic.Usage,
  };
}

function toolUseTurn(id: string): Partial<Anthropic.Message> {
  return {
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    content: [
      {
        type: "tool_use",
        id,
        name: "measure",
        input: {},
        caller: { type: "direct" },
      },
    ],
    usage: { input_tokens: 100, output_tokens: 10 } as Anthropic.Usage,
  };
}

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("completeText prompt caching (MTR-221)", () => {
  it("sends the system prompt as a block array with cache_control on the final block", async () => {
    createMock.mockResolvedValueOnce(textTurn("hello"));

    const out = await completeText({ system: "SYS", prompt: "make a cube" });

    expect(out).toBe("hello");
    const body = createMock.mock.calls[0][0];
    expect(body.system).toEqual([
      { type: "text", text: "SYS", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("forwards cache read/write tokens from the response usage to the meter", async () => {
    createMock.mockResolvedValueOnce(textTurn("hello"));
    const meter = new CadMeter();

    await runWithCadContext({ meter }, () =>
      completeText({ system: "SYS", prompt: "make a cube", role: "plan" })
    );

    const summary = meter.summarize();
    expect(summary.model).toHaveLength(1);
    expect(summary.model[0]).toMatchObject({
      role: "plan",
      cacheReadTokens: 40,
      cacheWriteTokens: 60,
    });
  });
});

describe("agentic loop prompt caching (MTR-221)", () => {
  it("marks the final system block and the last tool definition, and moves one breakpoint onto the newest tool_result", async () => {
    // Two tool turns, then a graceful stop: the third request carries two
    // tool_result user turns, so the moving breakpoint has somewhere to move.
    createMock
      .mockResolvedValueOnce(toolUseTurn("tu1"))
      .mockResolvedValueOnce(toolUseTurn("tu2"))
      .mockResolvedValueOnce(textTurn("stopping"));

    await runAgenticHarness({ prompt: "a 20mm cube" });

    expect(createMock).toHaveBeenCalledTimes(3);

    // Invariant prefix: cache_control on the final system block…
    const first = createMock.mock.calls[0][0];
    expect(first.system).toEqual([
      expect.objectContaining({
        type: "text",
        cache_control: { type: "ephemeral" },
      }),
    ]);
    // …and on the last tool definition only.
    const tools = first.tools as Anthropic.Tool[];
    expect(tools.length).toBeGreaterThan(1);
    expect(tools[tools.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
    for (const tool of tools.slice(0, -1)) {
      expect(tool.cache_control).toBeUndefined();
    }

    // First request has no tool_result yet — no message-level breakpoint.
    const firstMessages = first.messages as Anthropic.MessageParam[];
    expect(JSON.stringify(firstMessages)).not.toContain("cache_control");

    // Third request: exactly ONE tool_result carries cache_control (the
    // newest), so breakpoints move rather than accumulate. Total budget used:
    // system (1) + last tool (1) + newest tool_result (1) = 3 of 4.
    const third = createMock.mock.calls[2][0];
    const messages = third.messages as Anthropic.MessageParam[];
    const marked: string[] = [];
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (
          block.type === "tool_result" &&
          "cache_control" in block &&
          block.cache_control
        ) {
          marked.push(block.tool_use_id);
        }
      }
    }
    expect(marked).toEqual(["tu2"]);

    // The last message's final content block is the marked tool_result.
    const lastMsg = messages[messages.length - 1];
    const lastBlocks = lastMsg.content as Anthropic.ContentBlockParam[];
    const finalBlock = lastBlocks[lastBlocks.length - 1];
    expect(finalBlock).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu2",
      cache_control: { type: "ephemeral" },
    });
  });
});
