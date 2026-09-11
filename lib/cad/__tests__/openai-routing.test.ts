import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Vendor routing: when a role resolves to an OpenAI id, the call has to leave
 * on the Responses API with the role's reasoning effort attached — and the
 * agentic loop has to keep its tool round-trip intact across the translation
 * (Anthropic-shaped history in, Responses items out, synthetic Message back).
 *
 * The mocked SDK captures raw request bodies so these assert the wire shape
 * rather than the adapter's internal bookkeeping.
 */

const responsesCreate = vi.fn<
  (body: Record<string, unknown>, opts?: unknown) => Promise<unknown>
>();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = {
      create: (...args: Parameters<typeof responsesCreate>) =>
        responsesCreate(...args),
    };
  },
}));

// Present but never expected to fire — a call landing here instead of on the
// OpenAI mock is exactly the routing bug these tests exist to catch.
const anthropicCreate = vi.fn(async () => {
  throw new Error("routed to Anthropic, expected OpenAI");
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: anthropicCreate,
      stream: () => ({ finalMessage: anthropicCreate }),
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

const ENV = ["OAI_SECRET_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CAD_PROVIDER", "CAD_BRIEF_STEP"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];

function textResponse(text: string) {
  return {
    id: "resp_1",
    model: "gpt-6-astra",
    output_text: text,
    output: [],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 40, cache_write_tokens: 60 },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
}

function toolCallResponse(id: string, callId: string) {
  return {
    id,
    model: "gpt-6-astra",
    output_text: "",
    output: [
      {
        type: "function_call",
        call_id: callId,
        name: "measure",
        arguments: "{}",
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
}

beforeEach(() => {
  responsesCreate.mockReset();
  anthropicCreate.mockClear();
  for (const k of ENV) delete process.env[k];
  process.env.OAI_SECRET_KEY = "sk-oai-test";
  process.env.CAD_BRIEF_STEP = "false";
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("completeText on OpenAI", () => {
  it("sends the system prompt as instructions and the role's effort as reasoning", async () => {
    responsesCreate.mockResolvedValueOnce(textResponse("hello"));

    const out = await completeText({
      system: "SYS",
      prompt: "make a cube",
      role: "plan",
    });

    expect(out).toBe("hello");
    expect(anthropicCreate).not.toHaveBeenCalled();
    const body = responsesCreate.mock.calls[0][0];
    expect(body.model).toBe("gpt-6-astra");
    expect(body.instructions).toBe("SYS");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "make a cube" }] },
    ]);
    // Nothing chains off a one-shot, so the prompt need not be retained.
    expect(body.store).toBe(false);
  });

  it("captions reference images the same way the Anthropic path does", async () => {
    responsesCreate.mockResolvedValueOnce(textResponse("ok"));

    await completeText({
      system: "SYS",
      prompt: "match this",
      images: [{ label: "Reference 1", mediaType: "image/png", data: "AAA" }],
    });

    const content = (responsesCreate.mock.calls[0][0].input as
      | { content: { type: string; text?: string; image_url?: string }[] }[])[0]
      .content;
    expect(content.map((c) => c.type)).toEqual([
      "input_text",
      "input_text",
      "input_image",
    ]);
    expect(content[1].text).toBe("Reference 1");
    expect(content[2].image_url).toBe("data:image/png;base64,AAA");
  });

  it("meters OpenAI cached-input tokens in the same shape as Anthropic's", async () => {
    responsesCreate.mockResolvedValueOnce(textResponse("hello"));
    const meter = new CadMeter();

    await runWithCadContext({ meter }, () =>
      completeText({ system: "SYS", prompt: "make a cube", role: "plan" })
    );

    expect(meter.summarize().model[0]).toMatchObject({
      role: "plan",
      model: "gpt-6-astra",
      cacheReadTokens: 40,
      cacheWriteTokens: 60,
    });
  });

  it("routes back to Anthropic when a role pins a Claude model", async () => {
    responsesCreate.mockResolvedValueOnce(textResponse("unused"));
    process.env.CAD_MODEL_PLAN = "claude-opus-5";

    await expect(
      completeText({ system: "SYS", prompt: "x", role: "plan" })
    ).rejects.toThrow("routed to Anthropic");

    delete process.env.CAD_MODEL_PLAN;
    expect(responsesCreate).not.toHaveBeenCalled();
  });
});

describe("agentic loop on OpenAI", () => {
  it("chains turns by response id and sends only the newest turn each time", async () => {
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse("resp_a", "call_1"))
      .mockResolvedValueOnce(toolCallResponse("resp_b", "call_2"))
      .mockResolvedValueOnce(textResponse("stopping"));

    await runAgenticHarness({ prompt: "a 20mm cube" });

    expect(responsesCreate).toHaveBeenCalledTimes(3);
    expect(anthropicCreate).not.toHaveBeenCalled();

    // Turn 1: the task itself, no chaining handle yet.
    const first = responsesCreate.mock.calls[0][0];
    expect(first.previous_response_id).toBeUndefined();
    expect(first.store).toBe(true);
    expect((first.input as { role?: string }[])[0].role).toBe("user");
    expect(first.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "exec" }),
      ])
    );

    // Turn 2: continues turn 1's reasoning chain and carries ONLY the tool
    // output — resending the history here is what would drop the chain.
    const second = responsesCreate.mock.calls[1][0];
    expect(second.previous_response_id).toBe("resp_a");
    expect(second.input).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_1",
      }),
    ]);

    // Turn 3 answers the second call and chains off the second response.
    const third = responsesCreate.mock.calls[2][0];
    expect(third.previous_response_id).toBe("resp_b");
    expect(third.input).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_2",
      }),
    ]);
  });

  it("drops the chaining handle when storage is refused", async () => {
    process.env.CAD_OPENAI_STORE = "false";
    responsesCreate
      .mockResolvedValueOnce(toolCallResponse("resp_a", "call_1"))
      .mockResolvedValueOnce(textResponse("stopping"));

    await runAgenticHarness({ prompt: "a 20mm cube" });

    delete process.env.CAD_OPENAI_STORE;
    for (const call of responsesCreate.mock.calls) {
      expect(call[0].store).toBe(false);
      expect(call[0].previous_response_id).toBeUndefined();
    }
  });
});
