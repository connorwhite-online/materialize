import { describe, it, expect } from "vitest";

import {
  CadTranscriptRecorder,
  stripImagePayloads,
} from "@/lib/cad/transcript";
import { runWithCadContext } from "@/lib/cad/metering";

const IDS = { jobId: "job-1", generationId: "gen-1", prompt: "a bracket" };

function modelCall(overrides: Partial<Parameters<CadTranscriptRecorder["recordModelCall"]>[0]> = {}) {
  return {
    role: "implement",
    model: "m",
    system: "SYSTEM",
    prompt: "make it",
    imageLabels: [],
    response: "```python\nresult = 1\n```",
    ms: 10,
    ...overrides,
  };
}

describe("CadTranscriptRecorder", () => {
  it("dedupes byte-identical system prompts into one systems entry", () => {
    const r = new CadTranscriptRecorder(IDS);
    r.recordModelCall(modelCall());
    r.recordModelCall(modelCall({ role: "repair" }));
    r.recordModelCall(modelCall({ system: "OTHER SYSTEM", role: "critique" }));

    const t = r.serialize();
    expect(t.systems).toEqual(["SYSTEM", "OTHER SYSTEM"]);
    expect(t.events.map((e) => (e.kind === "model" ? e.systemRef : -1))).toEqual([
      0, 0, 1,
    ]);
  });

  it("records execs with code, verdict, and render", () => {
    const r = new CadTranscriptRecorder(IDS);
    r.recordExec({
      source: "runner",
      code: "result = 1",
      ok: false,
      error: "not a solid",
      validation: { isSolid: false },
      render: "UkVOREVS",
    });
    const [e] = r.serialize().events;
    expect(e.kind).toBe("exec");
    if (e.kind === "exec") {
      expect(e.code).toBe("result = 1");
      expect(e.error).toBe("not a solid");
      expect(e.render).toBe("UkVOREVS");
    }
  });

  it("caps events and marks truncation instead of growing unbounded", () => {
    const r = new CadTranscriptRecorder(IDS);
    for (let i = 0; i < 600; i++) {
      r.recordExec({ source: "runner", code: `c${i}`, ok: true });
    }
    const t = r.serialize();
    expect(t.events.length).toBe(500);
    expect(t.truncated).toBe(true);
  });

  it("hasEvents gates empty transcripts", () => {
    const r = new CadTranscriptRecorder(IDS);
    expect(r.hasEvents()).toBe(false);
    r.recordModelCall(modelCall());
    expect(r.hasEvents()).toBe(true);
  });

  it("is reachable through the generation context like the meter", () => {
    const r = new CadTranscriptRecorder(IDS);
    runWithCadContext({ recorder: r }, () => {
      r.recordModelCall(modelCall());
    });
    expect(r.hasEvents()).toBe(true);
  });
});

describe("stripImagePayloads", () => {
  it("replaces base64 image sources but keeps structure and text", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "build it" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "HUGE" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "exec", input: { code: "x" } },
        ],
      },
    ];
    const stripped = stripImagePayloads(messages) as typeof messages;
    expect(stripped[0].content[0]).toEqual({ type: "text", text: "build it" });
    expect(stripped[0].content[1]).toEqual({
      type: "image",
      source: "[image payload omitted]",
    });
    expect(stripped[1].content[0]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "exec",
      input: { code: "x" },
    });
    // Original untouched.
    expect(
      (messages[0].content[1] as { source: { data?: string } }).source.data
    ).toBe("HUGE");
  });
});
