import { describe, it, expect } from "vitest";

import {
  CadMeter,
  runWithCadContext,
  activeCadContext,
  meterModelUsage,
  meterSidecarCall,
  meterFalCall,
} from "@/lib/cad/metering";

describe("CadMeter", () => {
  it("aggregates model usage per (role, model) pair", () => {
    const meter = new CadMeter();
    meter.recordModelUsage({
      role: "implement",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      ms: 800,
    });
    meter.recordModelUsage({
      role: "implement",
      model: "claude-sonnet-4-6",
      inputTokens: 2000,
      outputTokens: 700,
      ms: 900,
    });
    meter.recordModelUsage({
      role: "repair",
      model: "claude-sonnet-4-6",
      inputTokens: 400,
      outputTokens: 100,
      ms: 300,
    });

    const summary = meter.summarize();
    expect(summary.v).toBe(1);
    expect(summary.model).toHaveLength(2);
    const impl = summary.model.find((m) => m.role === "implement");
    expect(impl).toEqual({
      role: "implement",
      model: "claude-sonnet-4-6",
      calls: 2,
      inputTokens: 3000,
      outputTokens: 1200,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      ms: 1700,
    });
  });

  it("aggregates sidecar and fal usage, and stamps the route", () => {
    const meter = new CadMeter();
    meter.recordSidecarCall(1200);
    meter.recordSidecarCall(800);
    meter.recordFalCall("fal-ai/flux/schnell", 1500);
    meter.recordFalCall("fal-ai/hunyuan3d/v2", 30_000);
    meter.recordFalCall("fal-ai/hunyuan3d/v2", 28_000);

    const summary = meter.summarize("organic");
    expect(summary.sidecar).toEqual({ calls: 2, ms: 2000 });
    expect(summary.fal).toEqual([
      { model: "fal-ai/flux/schnell", calls: 1, ms: 1500 },
      { model: "fal-ai/hunyuan3d/v2", calls: 2, ms: 58_000 },
    ]);
    expect(summary.route).toBe("organic");
  });

  it("omits route when not provided and clamps negative inputs", () => {
    const meter = new CadMeter();
    meter.recordModelUsage({
      role: "plan",
      model: "m",
      inputTokens: -5,
      outputTokens: 10,
      ms: -100,
    });
    meter.recordSidecarCall(-50);
    const summary = meter.summarize();
    expect(summary.route).toBeUndefined();
    expect(summary.model[0].inputTokens).toBe(0);
    expect(summary.model[0].ms).toBe(0);
    expect(summary.sidecar.ms).toBe(0);
  });
});

describe("cad generation context", () => {
  it("record helpers write into the active meter across async boundaries", async () => {
    const meter = new CadMeter();
    await runWithCadContext({ meter }, async () => {
      await Promise.resolve();
      meterModelUsage({
        role: "plan",
        model: "m",
        inputTokens: 1,
        outputTokens: 2,
        ms: 3,
      });
      // Nested async work (mirrors best-of-N candidates sharing the meter).
      await Promise.all([
        (async () => meterSidecarCall(10))(),
        (async () => meterFalCall("f", 20))(),
      ]);
      expect(activeCadContext()?.meter).toBe(meter);
    });

    const summary = meter.summarize();
    expect(summary.model[0].calls).toBe(1);
    expect(summary.sidecar.calls).toBe(1);
    expect(summary.fal[0].model).toBe("f");
  });

  it("record helpers are hard no-ops outside a context (evals, scripts)", () => {
    expect(activeCadContext()).toBeUndefined();
    // Must not throw and must not blow up any global state.
    meterModelUsage({ role: "x", model: "y", inputTokens: 1, outputTokens: 1, ms: 1 });
    meterSidecarCall(5);
    meterFalCall("f", 5);
    expect(activeCadContext()).toBeUndefined();
  });

  it("carries credentials for the BYOK seam", () => {
    runWithCadContext(
      { credentials: { source: "user", apiKey: "sk-test" } },
      () => {
        expect(activeCadContext()?.credentials).toEqual({
          source: "user",
          apiKey: "sk-test",
        });
      }
    );
  });
});
