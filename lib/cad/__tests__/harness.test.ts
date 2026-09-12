import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

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

// Aesthetic judge is gated off by default (no CAD_AESTHETIC_JUDGE flag); leave
// it real so a passing run's judgement short-circuits to { available: false }
// without needing further mocking.

import { runHarness } from "@/lib/cad/harness";
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
