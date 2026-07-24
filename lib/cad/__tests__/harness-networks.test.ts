import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CadNetworksReport, CadRunResult } from "@/lib/cad/types";

// Same mocking shape as harness-enclosure.test.ts: model + runner deterministic.
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

import { repairHintFor, runHarness } from "@/lib/cad/harness";

function exchangerRun(networks?: CadNetworksReport): CadRunResult {
  return {
    ok: true,
    files: { stl: "AA==" },
    geometry: { dimensions: { x: 48, y: 48, z: 33 } },
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
      bodyCount: 1,
    },
    ...(networks ? { checks: { networks } } : {}),
  };
}

const LEAK: CadNetworksReport = {
  isolated: false,
  pitch: 0.75,
  components: 1,
  ports: { a_in: 1, a_out: 1, b_in: 1, b_out: 1 },
};

const ISOLATED: CadNetworksReport = {
  isolated: true,
  pitch: 0.75,
  components: 2,
  minWallVoxels: 1,
  plugs: 4,
  ports: { a_in: 1, a_out: 1, b_in: 2, b_out: 2 },
};

function isolationRepairPrompts(): string[] {
  return completeText.mock.calls
    .map((c) => ((c as unknown[])[0] as { prompt?: string } | undefined)?.prompt ?? "")
    .filter((p) => p.includes("failed isolation"));
}

describe("repairHintFor fluid isolation (MTR-179)", () => {
  it("gives concrete geometry fixes for an isolation failure", () => {
    const hint = repairHintFor(
      'the fluid circuits failed isolation — circuits "a" and "b" share one void'
    );
    expect(hint).toMatch(/wall/i);
    expect(hint).toMatch(/seal/i);
    expect(hint).toMatch(/exchanger_core/);
  });
});

describe("runHarness dual-fluid isolation enforcement (MTR-179)", () => {
  beforeEach(() => {
    hasModelCredentials.mockReset().mockReturnValue(true);
    completeText.mockReset().mockResolvedValue("```python\nresult = 1\n```");
    runCadCode.mockReset();
    process.env.CAD_PLAN_STEP = "false";
    process.env.CAD_CRITIQUE = "false";
  });

  it("spends a repair turn on a leak, then accepts the isolated rebuild", async () => {
    runCadCode
      .mockResolvedValueOnce(exchangerRun(LEAK))
      .mockResolvedValueOnce(exchangerRun(ISOLATED));

    const result = await runHarness({
      prompt: "a dual-fluid gyroid heat exchanger, hot across cold",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    const hints = isolationRepairPrompts();
    expect(hints.length).toBe(1);
    // The diagnosis names the leak and the vocabulary to fix it.
    expect(hints[0]).toMatch(/LEAK/);
    expect(hints[0]).toMatch(/exchanger_core/);
  });

  it("accepts a verified-isolated exchanger on the first attempt", async () => {
    runCadCode.mockResolvedValue(exchangerRun(ISOLATED));

    const result = await runHarness({
      prompt: "a dual-fluid gyroid heat exchanger core",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(isolationRepairPrompts()).toHaveLength(0);
    // The verdict rides the returned run for persistence/UI.
    expect(result.run?.checks?.networks?.isolated).toBe(true);
  });

  it("ignores parts with no fluid circuits (check never ran)", async () => {
    runCadCode.mockResolvedValue(exchangerRun(undefined));

    const result = await runHarness({
      prompt: "a 40mm parametric cube",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(isolationRepairPrompts()).toHaveLength(0);
  });

  it("demands the declaration when an exchanger prompt ran no isolation check", async () => {
    // First attempt: exchanger prompt but NO networks report (the script
    // never validly declared fluid_ports — the hole that shipped a solid
    // block). Second attempt declares and verifies.
    runCadCode
      .mockResolvedValueOnce(exchangerRun(undefined))
      .mockResolvedValueOnce(exchangerRun(ISOLATED));

    const result = await runHarness({
      prompt: "a dual-fluid gyroid heat exchanger, hot across cold",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    const declPrompts = completeText.mock.calls
      .map((c) => ((c as unknown[])[0] as { prompt?: string } | undefined)?.prompt ?? "")
      .filter((p) => p.includes("NO isolation check ran"));
    expect(declPrompts).toHaveLength(1);
    expect(declPrompts[0]).toMatch(/fluid_ports/);
    expect(declPrompts[0]).toMatch(/fluid_min_feature/);
    expect(result.run?.checks?.networks?.isolated).toBe(true);
  });

  it("treats a malformed-declaration error as a repair-worthy failure", async () => {
    runCadCode
      .mockResolvedValueOnce(
        exchangerRun({ error: "fluid_ports malformed — expected a list" })
      )
      .mockResolvedValueOnce(exchangerRun(ISOLATED));

    const result = await runHarness({
      prompt: "a dual-fluid gyroid heat exchanger",
      maxAttempts: 4,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    const hints = isolationRepairPrompts();
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/fluid_ports malformed/);
  });

  it("accepts the last attempt rather than hard-failing when the leak persists", async () => {
    runCadCode.mockResolvedValue(exchangerRun(LEAK));

    const result = await runHarness({
      prompt: "a dual-fluid gyroid heat exchanger",
      maxAttempts: 2,
    });

    // Budget exhausted: the (leaky) result still returns for persistence —
    // the verdict on run.checks.networks tells the caller/UI the truth.
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(isolationRepairPrompts()).toHaveLength(1);
    expect(result.run?.checks?.networks?.isolated).toBe(false);
  });
});
