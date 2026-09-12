import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Route-shape tests: mock every engine so the router's dispatch — not the
// engines — is what's under test.
const runHarness = vi.fn();
const runAgenticHarness = vi.fn();
const runGenerative = vi.fn();
const shouldUseGenerative = vi.fn();
const generativeEnabled = vi.fn();
const completeText = vi.fn();
const hasModelCredentials = vi.fn();
const sessionsAvailable = vi.fn();

vi.mock("@/lib/cad/harness", () => ({
  runHarness: (...a: unknown[]) => runHarness(...a),
}));
vi.mock("@/lib/cad/agentic", async (importOriginal) => ({
  // Real CadAgenticError so orchestrate's instanceof salvage check works.
  CadAgenticError: (await importOriginal<typeof import("@/lib/cad/agentic")>())
    .CadAgenticError,
  runAgenticHarness: (...a: unknown[]) => runAgenticHarness(...a),
}));
vi.mock("@/lib/cad/generative", () => ({
  runGenerative: (...a: unknown[]) => runGenerative(...a),
  shouldUseGenerative: (...a: unknown[]) => shouldUseGenerative(...a),
  generativeEnabled: () => generativeEnabled(),
}));
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...a: unknown[]) => completeText(...a),
  hasModelCredentials: () => hasModelCredentials(),
}));
vi.mock("@/lib/cad/session-client", () => ({
  sessionsAvailable: () => sessionsAvailable(),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { runCadGeneration, classifyCadRequest } from "@/lib/cad/orchestrate";
import { activeCadTier } from "@/lib/cad/budget";

const RESULT = { ok: true, sourceCode: "x", attempts: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  runHarness.mockResolvedValue({ ...RESULT, sourceCode: "harness" });
  runAgenticHarness.mockResolvedValue({ ...RESULT, sourceCode: "agentic" });
  runGenerative.mockResolvedValue({ ...RESULT, sourceCode: "generative" });
  shouldUseGenerative.mockResolvedValue(false);
  generativeEnabled.mockReturnValue(false);
  hasModelCredentials.mockReturnValue(true);
  sessionsAvailable.mockReturnValue(true);
  delete process.env.CAD_AGENTIC;
});

afterEach(() => {
  delete process.env.CAD_AGENTIC;
});

describe("classifyCadRequest", () => {
  it.each([
    ["SIMPLE", "simple"],
    ["COMPLEX", "complex"],
    ["ORGANIC", "organic"],
    ["I think COMPLEX fits", "complex"],
  ])("maps %s -> %s", async (reply, expected) => {
    completeText.mockResolvedValue(reply);
    expect(await classifyCadRequest("a part")).toBe(expected);
  });

  it("lands on simple on any classifier failure (safe landing)", async () => {
    completeText.mockRejectedValue(new Error("down"));
    expect(await classifyCadRequest("a part")).toBe("simple");
  });
});

describe("runCadGeneration routing", () => {
  it("CAD_AGENTIC=false reproduces the legacy path exactly", async () => {
    process.env.CAD_AGENTIC = "false";
    await runCadGeneration({ prompt: "a 20mm cube" });
    expect(runHarness).toHaveBeenCalledTimes(1);
    expect(runAgenticHarness).not.toHaveBeenCalled();
    // The classifier must not even run on the legacy path.
    expect(completeText).not.toHaveBeenCalled();
  });

  it("no sessions -> legacy path (agentic requires a real sidecar)", async () => {
    sessionsAvailable.mockReturnValue(false);
    await runCadGeneration({ prompt: "anything" });
    expect(runHarness).toHaveBeenCalledTimes(1);
    expect(runAgenticHarness).not.toHaveBeenCalled();
  });

  it("CAD-11: legacy path + generative selected reports route legacy-generative, not legacy", async () => {
    process.env.CAD_AGENTIC = "false";
    generativeEnabled.mockReturnValue(true);
    shouldUseGenerative.mockResolvedValue(true);
    const r = await runCadGeneration({ prompt: "a dragon figurine" });
    expect(runGenerative).toHaveBeenCalledTimes(1);
    expect(r.sourceCode).toBe("generative");
    expect(r.route).toBe("legacy-generative");
  });

  it("simple -> scripted loop", async () => {
    completeText.mockResolvedValue("SIMPLE");
    const r = await runCadGeneration({ prompt: "a cube" });
    expect(r.sourceCode).toBe("harness");
  });

  it("complex -> agentic loop", async () => {
    completeText.mockResolvedValue("COMPLEX");
    const r = await runCadGeneration({ prompt: "a 6-port enclosure" });
    expect(r.sourceCode).toBe("agentic");
  });

  it("complex falls back to the scripted loop on agentic failure", async () => {
    completeText.mockResolvedValue("COMPLEX");
    runAgenticHarness.mockRejectedValue(new Error("session died"));
    const r = await runCadGeneration({ prompt: "a 6-port enclosure" });
    expect(r.sourceCode).toBe("harness");
  });

  it("stamps route + fallback events into the progress stream (observability)", async () => {
    completeText.mockResolvedValue("COMPLEX");
    runAgenticHarness.mockRejectedValue(new Error("session died"));
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    await runCadGeneration({
      prompt: "a 6-port enclosure",
      onProgress: (ev) => events.push(ev as (typeof events)[number]),
    });
    expect(events).toContainEqual({ type: "route", route: "complex" });
    const fb = events.find((e) => e.type === "fallback");
    expect(fb).toMatchObject({ from: "agentic", to: "scripted" });
    expect(String(fb?.reason)).toContain("session died");
  });

  it("stamps the simple route too", async () => {
    completeText.mockResolvedValue("SIMPLE");
    const events: Array<{ type: string }> = [];
    await runCadGeneration({
      prompt: "a cube",
      onProgress: (ev) => events.push(ev as (typeof events)[number]),
    });
    expect(events).toContainEqual({ type: "route", route: "simple" });
  });

  it("budget-cutoff salvage: too little deadline left -> keeps the best-so-far instead of a doomed scripted rebuild", async () => {
    const { CadAgenticError } = await import("@/lib/cad/agentic");
    completeText.mockResolvedValue("COMPLEX");
    const salvage = { ...RESULT, sourceCode: "salvaged" };
    runAgenticHarness.mockRejectedValue(
      new CadAgenticError("budget hit", { salvage })
    );
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const r = await runCadGeneration({
      prompt: "a 6-port enclosure",
      deadlineAt: Date.now() + 30_000, // < MIN_SCRIPTED_FALLBACK_MS
      onProgress: (ev) => events.push(ev as (typeof events)[number]),
    });
    expect(r.sourceCode).toBe("salvaged");
    expect(r.route).toBe("complex-salvage");
    expect(runHarness).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "fallback")).toMatchObject({
      from: "agentic",
      to: "salvage",
    });
  });

  it("budget-cutoff salvage: scripted rebuild still preferred when time allows, salvage only on its failure", async () => {
    const { CadAgenticError } = await import("@/lib/cad/agentic");
    completeText.mockResolvedValue("COMPLEX");
    const salvage = { ...RESULT, sourceCode: "salvaged" };
    runAgenticHarness.mockRejectedValue(
      new CadAgenticError("budget hit", { salvage })
    );
    // Plenty of time: scripted runs and wins when ok...
    runHarness.mockResolvedValue({ ...RESULT, sourceCode: "harness" });
    let r = await runCadGeneration({
      prompt: "x",
      deadlineAt: Date.now() + 600_000,
    });
    expect(r.sourceCode).toBe("harness");
    expect(r.route).toBe("complex-fallback");

    // ...but its failure degrades to the salvage, not to nothing.
    runHarness.mockResolvedValue({
      ok: false,
      sourceCode: "",
      attempts: 4,
      error: "no valid result",
    });
    r = await runCadGeneration({
      prompt: "x",
      deadlineAt: Date.now() + 600_000,
    });
    expect(r.sourceCode).toBe("salvaged");
    expect(r.route).toBe("complex-salvage");
  });

  it("complex propagates aborts instead of falling back", async () => {
    completeText.mockResolvedValue("COMPLEX");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    runAgenticHarness.mockRejectedValue(abort);
    await expect(runCadGeneration({ prompt: "x" })).rejects.toThrow("aborted");
    expect(runHarness).not.toHaveBeenCalled();
  });

  it("organic -> generative when enabled, scripted loop when not", async () => {
    completeText.mockResolvedValue("ORGANIC");
    generativeEnabled.mockReturnValue(true);
    let r = await runCadGeneration({ prompt: "a dragon figurine" });
    expect(r.sourceCode).toBe("generative");

    generativeEnabled.mockReturnValue(false);
    r = await runCadGeneration({ prompt: "a dragon figurine" });
    expect(r.sourceCode).toBe("harness");
  });
});

// The routing verdict is also the SPEND TIER (lib/cad/budget.ts). These pin
// the wiring rather than the numbers: that every engine runs inside the tier
// its verdict selected, and that the paths which promise pre-tier behavior
// stay untiered. The tier travels by AsyncLocalStorage, so "did it reach the
// engine" is only answerable from inside the engine.
describe("runCadGeneration spend tier", () => {
  const tierSeenBy = (fn: ReturnType<typeof vi.fn>) => {
    let seen: string | undefined = "not-called";
    fn.mockImplementation(async () => {
      seen = activeCadTier();
      return { ...RESULT, sourceCode: "x" };
    });
    return () => seen;
  };

  it("runs the scripted loop inside the simple tier", async () => {
    completeText.mockResolvedValue("SIMPLE");
    const seen = tierSeenBy(runHarness);
    await runCadGeneration({ prompt: "a 20mm cube" });
    expect(seen()).toBe("simple");
  });

  it("runs the agentic loop inside the complex tier", async () => {
    completeText.mockResolvedValue("COMPLEX");
    const seen = tierSeenBy(runAgenticHarness);
    await runCadGeneration({ prompt: "an exchanger" });
    expect(seen()).toBe("complex");
  });

  it("keeps the scripted FALLBACK on the complex tier", async () => {
    // The part didn't get simpler because the agentic engine fell over — the
    // rebuild needs complex's attempts, not simple's.
    completeText.mockResolvedValue("COMPLEX");
    runAgenticHarness.mockRejectedValue(new Error("session down"));
    const seen = tierSeenBy(runHarness);
    await runCadGeneration({ prompt: "an exchanger" });
    expect(seen()).toBe("complex");
  });

  it("runs the generative engine inside the organic tier", async () => {
    completeText.mockResolvedValue("ORGANIC");
    generativeEnabled.mockReturnValue(true);
    const seen = tierSeenBy(runGenerative);
    await runCadGeneration({ prompt: "a dragon" });
    expect(seen()).toBe("organic");
  });

  it("keeps an organic request on the organic tier when it falls through to the scripted loop", async () => {
    completeText.mockResolvedValue("ORGANIC");
    generativeEnabled.mockReturnValue(false);
    const seen = tierSeenBy(runHarness);
    await runCadGeneration({ prompt: "a dragon" });
    expect(seen()).toBe("organic");
  });

  it("leaves the legacy path untiered — it promises pre-tier behavior", async () => {
    process.env.CAD_AGENTIC = "false";
    const seen = tierSeenBy(runHarness);
    await runCadGeneration({ prompt: "a 20mm cube" });
    expect(seen()).toBeUndefined();
  });

  it("classifies OUTSIDE any tier, since the verdict is what picks one", async () => {
    let tierDuringClassify: string | undefined = "not-called";
    completeText.mockImplementation(async () => {
      tierDuringClassify = activeCadTier();
      return "SIMPLE";
    });
    await runCadGeneration({ prompt: "a 20mm cube" });
    expect(tierDuringClassify).toBeUndefined();
  });

  it("does not leak the tier back to the caller", async () => {
    completeText.mockResolvedValue("COMPLEX");
    await runCadGeneration({ prompt: "an exchanger" });
    expect(activeCadTier()).toBeUndefined();
  });
});
