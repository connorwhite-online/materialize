import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessResult } from "@/lib/cad/harness";

/**
 * Regression tests for the best-of-N failure path (CAD bake-off branch).
 *
 * Production evidence: of 12 recorded generation failures, FOUR were the
 * opaque string "generation failed" with attempts=0, all on route
 * simple-bestof2, all dead inside 48s. That string was invented here after
 * `.catch(() => null)` had already destroyed the real exception — and because
 * nothing was thrown, executeCadJob had no `detail` to write, so
 * cad_jobs.error_detail stayed null as well. A third of the failure corpus
 * erased itself. These pin that it cannot happen again.
 */

const hasModelCredentials = vi.fn(() => true);
vi.mock("@/lib/cad/model-client", () => ({
  hasModelCredentials: () => hasModelCredentials(),
  completeText: vi.fn(async () => "SIMPLE"),
}));

const runHarness = vi.fn<(input: unknown) => Promise<HarnessResult>>();
vi.mock("@/lib/cad/harness", () => ({
  runHarness: (input: unknown) => runHarness(input),
}));

vi.mock("@/lib/cad/agentic", () => ({
  runAgenticHarness: vi.fn(),
  CadAgenticError: class extends Error {},
}));
vi.mock("@/lib/cad/generative", () => ({
  generativeEnabled: () => false,
  shouldUseGenerative: async () => false,
  runGenerative: vi.fn(),
}));
vi.mock("@/lib/cad/session-client", () => ({ sessionsAvailable: () => false }));

import { runCadGeneration } from "@/lib/cad/orchestrate";

function okResult(score: number): HarnessResult {
  return {
    ok: true,
    sourceCode: "result = 1",
    attempts: 1,
    aestheticScore: score,
    run: {
      ok: true,
      files: {},
      validation: {
        compiled: true,
        isSolid: true,
        isWatertight: true,
        isManifold: true,
      },
    },
  };
}

describe("best-of-N failure handling", () => {
  beforeEach(() => {
    vi.stubEnv("CAD_BEST_OF", "2");
    runHarness.mockReset();
  });

  it("rethrows the real exception when every candidate throws", async () => {
    // The exception must SURVIVE: executeCadJob's catch is what writes it to
    // cad_jobs.error_detail, and it only fires if something is thrown.
    const boom = new Error("Anthropic API 529 overloaded");
    runHarness.mockRejectedValue(boom);
    await expect(runCadGeneration({ prompt: "a cube" })).rejects.toThrow(
      "Anthropic API 529 overloaded"
    );
  });

  it("never invents 'generation failed' in place of a real error", async () => {
    runHarness.mockRejectedValue(new Error("credentials missing"));
    await expect(
      runCadGeneration({ prompt: "a cube" })
    ).rejects.not.toThrow(/generation failed/);
  });

  it("propagates an abort instead of reporting it as a failure", async () => {
    // A user cancelling must reach executeCadJob as an AbortError so the job
    // ends "cancelled"; the old catch turned it into a generation failure.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    runHarness.mockRejectedValue(abort);
    await expect(runCadGeneration({ prompt: "a cube" })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("prefers a returned diagnosis over a thrown one", async () => {
    // A returned {ok:false} carries real kernel stderr; a throw may be
    // infrastructure. The diagnosis is the more useful signal.
    const diagnosed: HarnessResult = {
      ok: false,
      sourceCode: "result = 1",
      attempts: 3,
      error: "StdFail_NotDone: fillet radius too large",
    };
    runHarness
      .mockResolvedValueOnce(diagnosed)
      .mockRejectedValueOnce(new Error("transport blew up"));
    const result = await runCadGeneration({ prompt: "a cube" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/StdFail_NotDone/);
  });

  it("still picks the judge's favourite when candidates succeed", async () => {
    runHarness
      .mockResolvedValueOnce(okResult(60))
      .mockResolvedValueOnce(okResult(85));
    const result = await runCadGeneration({ prompt: "a cube" });
    expect(result.ok).toBe(true);
    expect(result.aestheticScore).toBe(85);
  });
});
