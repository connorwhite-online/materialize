import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

// Same mocking shape as harness.test.ts: keep model + runner deterministic.
const hasModelCredentials = vi.fn(() => true);
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

// No concept image / plan / brief model calls should distract the test; the
// brief step is skipped because we pass a providedBrief. Disable plan + concept.
vi.mock("@/lib/cad/concept", () => ({
  conceptImage: async () => null,
  CONCEPT_IMAGE_NOTE: "",
}));

import { runHarness } from "@/lib/cad/harness";

function solid(dims: { x: number; y: number; z: number }): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: dims },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
  };
}

describe("runHarness dimension contract (MTR-197)", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset();
    process.env.CAD_PLAN_STEP = "false";
    process.env.CAD_CRITIQUE = "false";
  });

  const briefWithHeightTarget = {
    v: 1 as const,
    part: "a 100x60x50 block",
    dimensionTargets: [
      { label: "overall height", kind: "bbox_span" as const, axis: "z" as const, value: 50, tolerance: 0.5 },
    ],
    components: [],
    interfaces: [],
    keepOut: [],
  };

  it("fails an out-of-spec generation, repairs with a dimension hint, and passes once corrected", async () => {
    // First attempt: valid solid but height is 42mm (spec 50 ±0.5) → dimension
    // repair. Second attempt: corrected to 50mm.
    runCadCode
      .mockResolvedValueOnce(solid({ x: 100, y: 60, z: 42 }))
      .mockResolvedValueOnce(solid({ x: 100, y: 60, z: 50 }));

    const result = await runHarness({
      prompt: "a 100x60x50mm block",
      providedBrief: briefWithHeightTarget,
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    // The repair turn must have carried a dimension-specific hint.
    const repairPrompt = completeText.mock.calls
      .map((c) => ((c as unknown[])[0] as { prompt?: string } | undefined)?.prompt ?? "")
      .find((p) => p.includes("DIMENSION CONTRACT VIOLATIONS"));
    expect(repairPrompt).toBeTruthy();
    expect(repairPrompt).toMatch(/overall height/);
    // The final result's checks all ran and passed.
    expect(result.dimensionChecks?.every((d) => d.ran && d.ok)).toBe(true);
  });

  it("accepts an on-target generation without a dimension repair turn", async () => {
    runCadCode.mockResolvedValue(solid({ x: 100, y: 60, z: 50 }));

    const result = await runHarness({
      prompt: "a 100x60x50mm block",
      providedBrief: briefWithHeightTarget,
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(runCadCode).toHaveBeenCalledTimes(1);
    expect(result.dimensionChecks?.[0]).toMatchObject({ ran: true, ok: true, got: 50 });
  });
});
