import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CadOutputTruncatedError, type CadRunResult } from "@/lib/cad/types";

// Keep the harness on its credential-free deterministic path unless a test
// opts in — hasModelCredentials()/completeText() are mocked so these tests
// never depend on ambient ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN.
const hasModelCredentials = vi.fn(() => false);
const completeText = vi.fn(async () => "```python\nresult = 1\n```");

vi.mock("@/lib/cad/model-client", () => ({
  hasModelCredentials: () => hasModelCredentials(),
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
}));

const runCadCode = vi.fn<
  (code: string, formats?: string[], signal?: AbortSignal) => Promise<CadRunResult>
>();

vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: Parameters<typeof runCadCode>) => runCadCode(...args),
}));

// Geometry-first concepts (CAD_CONCEPT_MODE=blockout): off unless a test
// turns it on, so every other test keeps the default image-concept path.
const blockoutState = { enabled: false };
const blockoutCandidates = vi.fn();
vi.mock("@/lib/cad/concept-blockout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cad/concept-blockout")>()),
  blockoutConceptsEnabled: () => blockoutState.enabled,
  blockoutCandidates: (...a: unknown[]) => blockoutCandidates(...a),
}));

// Aesthetic judge is gated off by default (no CAD_AESTHETIC_JUDGE flag); leave
// it real so a passing run's judgement short-circuits to { available: false }
// without needing further mocking.

import { attemptFloorMs, runHarness } from "@/lib/cad/harness";
import { runWithCadTier, tierBudget } from "@/lib/cad/budget";
import { CadMeter, runWithCadContext } from "@/lib/cad/metering";

function failingRun(): CadRunResult {
  return {
    ok: false,
    files: {},
    validation: {
      compiled: true,
      isSolid: false,
      isWatertight: false,
      isManifold: false,
    },
    error: "not a solid",
  };
}

describe("runHarness attempt counting (MTR-158)", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(false);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  it("reports 0 attempts (not maxAttempts) when aborted before any attempt runs", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 4,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(runCadCode).not.toHaveBeenCalled();
  });

  it("reports the real attempt count (1) on the single-attempt deterministic-fallback break, not maxAttempts", async () => {
    hasModelCredentials.mockReturnValue(false); // useModel = false -> break after 1 attempt

    const result = await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.attempts).not.toBe(4);
    expect(runCadCode).toHaveBeenCalledTimes(1);
  });

  it("reports the real attempt count on genuine exhaustion (regression guard: still equals maxAttempts when every attempt truly runs)", async () => {
    hasModelCredentials.mockReturnValue(true); // useModel = true -> loop runs to the cap

    const result = await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(runCadCode).toHaveBeenCalledTimes(3);
  });

  it("success path still reports the attempt it succeeded on", async () => {
    hasModelCredentials.mockReturnValue(false);
    runCadCode.mockResolvedValue({
      ok: true,
      files: { stl: "AA==" },
      validation: {
        compiled: true,
        isSolid: true,
        isWatertight: true,
        isManifold: true,
      },
    });

    const result = await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });
});

// The repair budget is proportional to the routing verdict (lib/cad/budget.ts):
// the 4 attempts the loop has always offered were chosen for parts that "clear
// a sequence of distinct build123d gotchas", which is not every part.
describe("runHarness attempt budget by tier", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(failingRun());
    delete process.env.CAD_MAX_TOKENS_PER_JOB;
  });

  afterEach(() => {
    delete process.env.CAD_MAX_TOKENS_PER_JOB;
  });

  it("spends the simple tier's attempts, not the complex tier's", async () => {
    const result = await runWithCadTier("simple", () =>
      runHarness({ prompt: "a 20mm cube" })
    );
    expect(result.attempts).toBe(tierBudget("simple").maxAttempts);
    expect(runCadCode).toHaveBeenCalledTimes(tierBudget("simple").maxAttempts);
  });

  it("keeps the full attempt budget on a complex part", async () => {
    const result = await runWithCadTier("complex", () =>
      runHarness({ prompt: "a heat exchanger" })
    );
    expect(result.attempts).toBe(tierBudget("complex").maxAttempts);
  });

  it("falls back to the historical default with no tier active", async () => {
    const result = await runHarness({ prompt: "a 20mm cube" });
    expect(result.attempts).toBe(4);
  });

  it("lets an explicit caller value win over the tier", async () => {
    const result = await runWithCadTier("simple", () =>
      runHarness({ prompt: "a 20mm cube", maxAttempts: 3 })
    );
    expect(result.attempts).toBe(3);
  });

  it("stops repairing once the token ceiling is spent, keeping what it has", async () => {
    process.env.CAD_MAX_TOKENS_PER_JOB = "10";
    const meter = new CadMeter();
    meter.recordModelUsage({
      role: "implement",
      model: "claude-opus-5",
      inputTokens: 100,
      outputTokens: 100,
      ms: 1,
    });

    const result = await runWithCadContext({ meter }, () =>
      runHarness({ prompt: "a 20mm cube", maxAttempts: 4 })
    );

    // The first attempt always runs — a generation that is already over budget
    // before writing any build123d is a metering bug, not a reason to ship
    // nothing.
    expect(result.attempts).toBe(1);
    expect(runCadCode).toHaveBeenCalledTimes(1);
  });
});

// Prod, 2026-09-23: an SDF build started its second attempt with ~2 minutes
// left, the codegen call ran 5+ minutes, and the platform killed the job
// mid-call. It sat at "running" with no error, because nothing bounded the
// call itself.
describe("runHarness deadline", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  /** A codegen call that only ends when its signal fires, like a slow model. */
  function hangingCodegen() {
    completeText.mockReset().mockImplementation((async (opts: {
      role?: string;
      signal?: AbortSignal;
    }) => {
      if (opts.role !== "implement" && opts.role !== "repair") {
        return "```python\nresult = 1\n```";
      }
      return new Promise<string>((_, reject) => {
        const fail = () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (opts.signal?.aborted) return fail();
        opts.signal?.addEventListener("abort", fail);
      });
    }) as never);
  }

  it("cuts a codegen call at the deadline and returns a failure it can persist", async () => {
    hangingCodegen();
    const result = await runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 4,
      deadlineAt: Date.now() + 50,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ran out of time/);
    expect(runCadCode).not.toHaveBeenCalled();
  });

  it("still throws on a caller abort, so it lands as a cancellation", async () => {
    hangingCodegen();
    const controller = new AbortController();
    const run = runHarness({
      prompt: "a 20mm cube",
      maxAttempts: 4,
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("attemptFloorMs", () => {
  it("never goes below the one-minute floor", () => {
    expect(attemptFloorMs(0)).toBe(60_000);
    expect(attemptFloorMs(5_000)).toBe(60_000);
  });

  it("expects the next attempt to cost what the last one did", () => {
    // The 7-minute codegen call that started with 2 minutes left.
    expect(attemptFloorMs(430_000)).toBe(430_000);
  });
});

describe("runHarness output truncation", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  it("skips the sidecar for a cut-off program and asks the next attempt for a shorter one", async () => {
    let codegenCalls = 0;
    const prompts: string[] = [];
    completeText.mockReset().mockImplementation((async (opts: {
      role?: string;
      prompt: string;
    }) => {
      if (opts.role !== "implement" && opts.role !== "repair") {
        return "```python\nresult = 1\n```";
      }
      prompts.push(opts.prompt);
      codegenCalls++;
      if (codegenCalls === 1) {
        throw new CadOutputTruncatedError(opts.role, 32_000);
      }
      return "```python\nresult = 1\n```";
    }) as never);

    const result = await runHarness({ prompt: "a knob", maxAttempts: 2 });

    // Attempt 1 never reached the sidecar; attempt 2 did.
    expect(runCadCode).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(2);
    expect(prompts[1]).toContain("SHORTER program");
    // And the retry thinks less because its effort came down, not because it
    // was asked nicely.
    const caps = completeText.mock.calls
      .map((c) => (c as unknown[])[0] as { role?: string; effortCap?: string })
      .filter((o) => o.role === "implement" || o.role === "repair")
      .map((o) => o.effortCap);
    // Attempt 1 drafts at the ladder's start and is cut off; attempt 2 runs
    // one level BELOW that, not back up the ladder.
    expect(caps[0]).toBe("medium");
    expect(caps[1]).toBe("low");
  });
});

describe("runHarness empty response", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  it("never sends an empty program to the sidecar", async () => {
    // Local SDF run, 2026-09-23: thinking used the whole output budget, the
    // reply had no code, and "" ran as a valid script that assigned nothing.
    let codegenCalls = 0;
    const prompts: string[] = [];
    completeText.mockReset().mockImplementation((async (opts: {
      role?: string;
      prompt: string;
    }) => {
      if (opts.role !== "implement" && opts.role !== "repair") {
        return "```python\nresult = 1\n```";
      }
      prompts.push(opts.prompt);
      return ++codegenCalls === 1 ? "" : "```python\nresult = 1\n```";
    }) as never);

    const result = await runHarness({ prompt: "a knob", maxAttempts: 2 });

    expect(runCadCode).toHaveBeenCalledTimes(1);
    expect(runCadCode.mock.calls[0][0]).toBe("result = 1");
    expect(result.attempts).toBe(2);
    expect(prompts[1]).toContain("contained no Python code");
  });
});

describe("runHarness requests printability checks", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(false);
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  const dfmSpec = () =>
    ((runCadCode.mock.calls[0] as unknown[])[3] as { checks?: { dfm?: { minWall?: number } } })
      ?.checks?.dfm;

  it("asks the sidecar for DFM on every run, against the prompt's wall rule", async () => {
    // The harness used to request only `fit`: walls, overhangs and trapped
    // voids were never checked in the studio.
    await runHarness({ prompt: "a 20mm cube", maxAttempts: 1 });
    expect(dfmSpec()).toEqual({ minWall: 2.0 }); // multi-process safe envelope
  });

  it("uses the target process's minimum wall when one is known", async () => {
    await runHarness({ prompt: "a 20mm cube", maxAttempts: 1, process: "fdm" });
    expect(dfmSpec()).toEqual({ minWall: 1.0 });
  });
});

describe("runHarness effort ladder", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(failingRun());
  });

  it("drafts cheap and escalates one level per failed attempt", async () => {
    await runHarness({ prompt: "a bracket", maxAttempts: 3 });
    const efforts = completeText.mock.calls
      .map((c) => (c as unknown[])[0] as { role?: string; effortCap?: string })
      .filter((o) => o.role === "implement" || o.role === "repair")
      .map((o) => o.effortCap);
    expect(efforts).toEqual(["medium", "high", "xhigh"]);
  });
});

describe("runHarness geometry-first concepts", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset().mockResolvedValue(failingRun());
    blockoutState.enabled = true;
  });
  afterEach(() => {
    blockoutState.enabled = false;
  });

  it("offers blockouts in the picker and seeds implement with the PICKED one's code (SDF)", async () => {
    const { CONCEPT_BLOCKOUT_LABEL } = await import("@/lib/cad/concept-blockout");
    blockoutCandidates.mockResolvedValue([
      { direction: { label: "Soft", detail: "a" }, code: "SOFT_CODE", img: { data: "PNG_SOFT", mediaType: "image/png", label: CONCEPT_BLOCKOUT_LABEL } },
      { direction: { label: "Crisp", detail: "b" }, code: "CRISP_CODE", img: { data: "PNG_CRISP", mediaType: "image/png", label: CONCEPT_BLOCKOUT_LABEL } },
    ]);
    const onQuestion = vi.fn(async (q: { options: { id: string; thumbnail?: string }[] }) => {
      // the picker shows the blockout renders
      expect(q.options.map((o) => o.thumbnail)).toEqual(["PNG_SOFT", "PNG_CRISP"]);
      return q.options[1].id; // pick "Crisp"
    });
    await runHarness({ prompt: "a knob", maxAttempts: 1, engine: "sdf", onQuestion } as never);
    const implement = completeText.mock.calls
      .map((c) => (c as unknown[])[0] as { role?: string; prompt: string })
      .find((o) => o.role === "implement");
    expect(implement?.prompt).toContain("CRISP_CODE");
    expect(implement?.prompt).not.toContain("SOFT_CODE");
  });

  it("falls back to image concepts when fewer than two blockouts survive", async () => {
    blockoutCandidates.mockResolvedValue([]);
    const onQuestion = vi.fn(async () => "opt-1");
    await runHarness({ prompt: "a knob", maxAttempts: 1, engine: "sdf", onQuestion } as never);
    const implement = completeText.mock.calls
      .map((c) => (c as unknown[])[0] as { role?: string; prompt: string })
      .find((o) => o.role === "implement");
    expect(implement?.prompt).not.toContain("BLOCKOUT (massing only");
  });
});

// The judge ships in the background by default (judgeMode, lib/cad/critique):
// a part that passes the objective checks returns on that attempt, and the
// judge's inputs ride the result for the job to score after `done`.
describe("runHarness aesthetic judge placement", () => {
  const weakJudge = JSON.stringify(
    Object.fromEntries(
      ["recognizability", "proportion", "cohesion", "surfacing", "refinement"].map(
        (d) => [d, { score: 1, reason: "r", fix: `fix ${d}` }]
      )
    )
  );
  const passingRun = (): CadRunResult => ({
    ok: true,
    files: { stl: "AA==" },
    renderPng: "PNG",
    validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true },
  });
  const judgeCalls = () =>
    completeText.mock.calls.filter(
      (c) => ((c as unknown[])[0] as { role?: string }).role === "critique"
    ).length;

  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockImplementation((async (opts: { role?: string }) =>
      opts.role === "critique" ? weakJudge : "```python\nresult = 1\n```") as never);
    runCadCode.mockReset().mockResolvedValue(passingRun());
  });
  afterEach(() => {
    delete process.env.CAD_JUDGE;
  });

  it("ships on the objective checks and hands the judge's inputs back (default)", async () => {
    const result = await runHarness({ prompt: "a 20mm cube", maxAttempts: 2 });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(judgeCalls()).toBe(0);
    expect(result.aestheticScore).toBeNull();
    expect(result.pendingJudge).toMatchObject({ prompt: "a 20mm cube", renderPng: "PNG" });
  });

  it("CAD_JUDGE=inline restores the old loop: scored in-loop, weak spends a repair", async () => {
    process.env.CAD_JUDGE = "inline";
    const result = await runHarness({ prompt: "a 20mm cube", maxAttempts: 2 });
    expect(result.attempts).toBe(2);
    expect(judgeCalls()).toBe(2);
    expect(typeof result.aestheticScore).toBe("number");
    expect(result.pendingJudge).toBeUndefined();
  });

  it("CAD_JUDGE=off neither scores nor queues a score", async () => {
    process.env.CAD_JUDGE = "off";
    const result = await runHarness({ prompt: "a 20mm cube", maxAttempts: 2 });
    expect(result.attempts).toBe(1);
    expect(judgeCalls()).toBe(0);
    expect(result.pendingJudge).toBeUndefined();
  });
});
