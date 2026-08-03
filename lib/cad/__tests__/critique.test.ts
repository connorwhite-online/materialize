import { describe, it, expect, vi } from "vitest";
import {
  parseJudgement,
  judgeAesthetics,
  aestheticJudgeEnabled,
  buildJudgePrompt,
  PASS_THRESHOLD,
  CRITIQUE_RUBRIC,
} from "@/lib/cad/critique";

function judgeJson(scores: Record<string, number>): string {
  const dims = [
    "recognizability",
    "proportion",
    "cohesion",
    "surfacing",
    "refinement",
  ];
  const obj: Record<string, unknown> = {};
  for (const d of dims) obj[d] = { score: scores[d], reason: "r", fix: `fix ${d}` };
  return JSON.stringify(obj);
}

describe("parseJudgement", () => {
  it("computes a weighted 0-100 aggregate and passes a strong part", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 5,
        proportion: 5,
        cohesion: 5,
        surfacing: 4,
        refinement: 4,
      })
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBe(94); // (5*1+5*2+5*2+4*1+4*1)/7/5*100
    expect(r!.pass).toBe(true);
  });

  it("fails on the per-dimension floor even when the mean is high", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 5,
        proportion: 5,
        cohesion: 1, // <= floor (disjointed parts)
        surfacing: 5,
        refinement: 5,
      })
    );
    expect(r!.pass).toBe(false);
  });

  it("builds repair feedback from weak (<=3) dimensions", () => {
    const r = parseJudgement(
      judgeJson({
        recognizability: 5,
        proportion: 2,
        cohesion: 3,
        surfacing: 5,
        refinement: 5,
      })
    );
    expect(r!.feedback).toMatch(/proportion: fix proportion/);
    expect(r!.feedback).toMatch(/cohesion: fix cohesion/);
    expect(r!.feedback).not.toMatch(/recognizability/);
  });

  it("extracts JSON embedded in prose and clamps out-of-range scores", () => {
    const r = parseJudgement(
      `Here is my assessment:\n${judgeJson({
        recognizability: 9,
        proportion: 5,
        cohesion: 5,
        surfacing: 5,
        refinement: 5,
      })}\nThanks!`
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100); // 9 clamped to 5 → all 5s
  });

  it("returns null on malformed or incomplete responses", () => {
    expect(parseJudgement("no json here")).toBeNull();
    expect(parseJudgement('{"recognizability":{"score":5}}')).toBeNull(); // missing dims
  });
});

describe("rubric honesty rails (MTR-199)", () => {
  it("tells the judge review is diagnostic, not authoritative", () => {
    expect(CRITIQUE_RUBRIC).toMatch(/DIAGNOSTIC, not authoritative/i);
  });

  it("forbids claiming safety / tolerance / manufacturability", () => {
    // The judge must never assert checks it did not run.
    expect(CRITIQUE_RUBRIC).toMatch(/structural safety/i);
    expect(CRITIQUE_RUBRIC).toMatch(/tolerance/i);
    expect(CRITIQUE_RUBRIC).toMatch(/manufacturability/i);
    expect(CRITIQUE_RUBRIC).toMatch(/checked deterministically elsewhere/i);
  });

  it("names the opposed-iso + section packet it is scoring", () => {
    // Keeps the rubric honest about the coverage it actually receives.
    expect(CRITIQUE_RUBRIC).toMatch(/opposed isometric/i);
    expect(CRITIQUE_RUBRIC).toMatch(/section/i);
  });
});

describe("buildJudgePrompt (MTR-223 CoT-to-critic)", () => {
  const FRAMING =
    "Design intent (from the generator) — use this to understand what was attempted. Judge ONLY the rendered result against the user's request; intent explains choices, it never excuses visual defects.";

  it("is byte-identical to the legacy prompt without intent", () => {
    expect(buildJudgePrompt("a box")).toBe("Requested object: a box");
    expect(buildJudgePrompt("a box", {})).toBe("Requested object: a box");
    expect(buildJudgePrompt("a box", { plan: "" })).toBe(
      "Requested object: a box"
    );
  });

  it("includes the framing + plan when a plan is given", () => {
    const p = buildJudgePrompt("a box", { plan: "1. base\n2. fillets" });
    expect(p.startsWith("Requested object: a box")).toBe(true);
    expect(p).toContain(FRAMING);
    expect(p).toContain("Plan:\n1. base\n2. fillets");
  });

  it("includes the brief JSON when a brief is given", () => {
    const brief = { v: 1 as const, part: "a box", components: [], interfaces: [], keepOut: [] };
    const p = buildJudgePrompt("a box", { brief });
    expect(p).toContain(FRAMING);
    expect(p).toContain(`Brief: ${JSON.stringify(brief)}`);
  });

  it("guards against sycophancy: intent never excuses defects", () => {
    const p = buildJudgePrompt("a box", { plan: "anything" });
    expect(p).toMatch(/Judge ONLY the rendered result/);
    expect(p).toMatch(/never excuses visual defects/);
  });
});

describe("judgeAesthetics intent threading (MTR-223)", () => {
  async function judgeWithMockedModel(
    opts: Parameters<typeof judgeAesthetics>[0]
  ) {
    vi.resetModules();
    const completeText = vi.fn().mockResolvedValue(
      judgeJson({
        recognizability: 5,
        proportion: 5,
        cohesion: 5,
        surfacing: 5,
        refinement: 5,
      })
    );
    vi.doMock("@/lib/cad/model-client", () => ({
      completeText,
      hasModelCredentials: () => true,
    }));
    try {
      const mod = await import("@/lib/cad/critique");
      const res = await mod.judgeAesthetics(opts);
      return { res, completeText };
    } finally {
      vi.doUnmock("@/lib/cad/model-client");
      vi.resetModules();
    }
  }

  it("sends the intent-framed prompt to the vision model", async () => {
    const { res, completeText } = await judgeWithMockedModel({
      renderPng: "abc",
      prompt: "a box",
      intent: { plan: "1. base form" },
    });
    expect(res.available).toBe(true);
    const sent = completeText.mock.calls[0][0] as { prompt: string };
    expect(sent.prompt).toContain("Design intent (from the generator)");
    expect(sent.prompt).toContain("1. base form");
  });

  it("without intent the prompt is identical to before", async () => {
    const { completeText } = await judgeWithMockedModel({
      renderPng: "abc",
      prompt: "a box",
    });
    const sent = completeText.mock.calls[0][0] as { prompt: string };
    expect(sent.prompt).toBe("Requested object: a box");
  });
});

describe("gating", () => {
  it("is disabled by default (no flag / no creds) and judge is a no-op", async () => {
    expect(aestheticJudgeEnabled()).toBe(false);
    const res = await judgeAesthetics({ renderPng: "abc", prompt: "a box" });
    expect(res).toEqual({ available: false });
  });

  it("exposes a sane pass threshold", () => {
    expect(PASS_THRESHOLD).toBeGreaterThan(0);
    expect(PASS_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
