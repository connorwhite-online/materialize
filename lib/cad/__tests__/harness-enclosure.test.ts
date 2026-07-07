import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadRunResult } from "@/lib/cad/types";

// Same mocking shape as harness-dimensions.test.ts: model + runner deterministic.
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

vi.mock("@/lib/cad/concept", () => ({
  conceptImage: async () => null,
  CONCEPT_IMAGE_NOTE: "",
}));

import { runHarness } from "@/lib/cad/harness";

function singleShell(): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: { x: 90, y: 61, z: 9.2 } },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
  };
}

function assembly(): CadRunResult {
  const part = (z: number) => ({
    name: z > 15 ? "lid" : "base",
    files: { stl: "AA==" },
    geometry: { dimensions: { x: 90, y: 61, z } },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
  });
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: { x: 90, y: 61, z: 22 } },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
    parts: [part(22), part(6)],
  };
}

function repairPrompts(): string[] {
  return completeText.mock.calls
    .map((c) => ((c as unknown[])[0] as { prompt?: string } | undefined)?.prompt ?? "")
    .filter((p) => p.includes("TWO-PIECE enclosure"));
}

describe("runHarness enclosure split enforcement (MTR-213)", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset();
    process.env.CAD_PLAN_STEP = "false";
    process.env.CAD_CRITIQUE = "false";
  });

  it("repairs a single-shell enclosure toward the parts dict, then accepts the assembly", async () => {
    // Attempt 1: a valid single shell (the bug). Attempt 2: a base+lid assembly.
    runCadCode
      .mockResolvedValueOnce(singleShell())
      .mockResolvedValueOnce(assembly());

    const result = await runHarness({
      prompt: "a parametric enclosure for a Raspberry Pi with vents",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.run?.parts?.length).toBe(2);
    // The repair turn carried the targeted parts-dict hint, NOT a fuse-into-one hint.
    const hints = repairPrompts();
    expect(hints.length).toBe(1);
    expect(hints[0]).toContain('parts = {"base"');
    expect(hints[0]).not.toMatch(/one fused solid/i);
  });

  it("accepts a two-part enclosure on the first attempt with no split repair", async () => {
    runCadCode.mockResolvedValue(assembly());

    const result = await runHarness({
      prompt: "a two-piece housing for an ESP32 module",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(runCadCode).toHaveBeenCalledTimes(1);
    expect(repairPrompts()).toHaveLength(0);
  });

  it("does NOT force a split for a non-enclosure prompt", async () => {
    runCadCode.mockResolvedValue(singleShell());

    const result = await runHarness({
      prompt: "a 40mm parametric cube",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(repairPrompts()).toHaveLength(0);
  });

  it("accepts a single shell rather than hard-failing when the model never splits", async () => {
    // Every attempt returns a single shell; the enforcement must exhaust its
    // repair budget and then accept the valid single result (never hard-fail).
    runCadCode.mockResolvedValue(singleShell());

    const result = await runHarness({
      prompt: "an enclosure for a battery pack",
      maxAttempts: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    // One repair turn was spent (attempt 1 → repair → attempt 2 accepts).
    expect(repairPrompts()).toHaveLength(1);
  });
});
