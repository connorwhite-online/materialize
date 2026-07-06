import { describe, it, expect } from "vitest";

import {
  computeCostCents,
  unitPricesFromEnv,
  type CadUnitPrices,
} from "@/lib/billing/cad-pricing";
import type { CadUsageSummary } from "@/lib/cad/types";

const usage: CadUsageSummary = {
  v: 1,
  model: [
    {
      role: "implement",
      model: "claude-sonnet-4-6",
      calls: 3,
      inputTokens: 2_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      ms: 40_000,
    },
    {
      role: "plan",
      model: "claude-haiku-4-5",
      calls: 1,
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ms: 2_000,
    },
  ],
  sidecar: { calls: 4, ms: 120_000 }, // 2 minutes
  fal: [
    { model: "fal-ai/flux/schnell", calls: 1, ms: 1500 },
    { model: "fal-ai/hunyuan3d/v2", calls: 2, ms: 60_000 },
  ],
  route: "organic",
};

function prices(overrides: Partial<CadUnitPrices> = {}): CadUnitPrices {
  return {
    inputCentsPerMTok: 0,
    outputCentsPerMTok: 0,
    cacheReadCentsPerMTok: 0,
    cacheWriteCentsPerMTok: 0,
    modelOverrides: {},
    sidecarCentsPerMinute: 0,
    falCentsPerCall: 0,
    falCentsByModel: {},
    ...overrides,
  };
}

describe("unitPricesFromEnv", () => {
  it("defaults every price to 0 (metering-only shipped state)", () => {
    const p = unitPricesFromEnv({});
    expect(p).toEqual(prices());
    expect(computeCostCents(usage, p)).toBe(0);
  });

  it("reads numeric env vars and JSON maps, ignoring garbage safely", () => {
    const p = unitPricesFromEnv({
      CAD_PRICE_MTOK_INPUT_CENTS: "300",
      CAD_PRICE_MTOK_OUTPUT_CENTS: "not-a-number",
      CAD_PRICE_SIDECAR_MINUTE_CENTS: "-4",
      CAD_PRICE_FAL_JSON: '{"fal-ai/hunyuan3d/v2":16}',
      CAD_PRICE_MODEL_JSON: "{broken json",
    });
    expect(p.inputCentsPerMTok).toBe(300);
    expect(p.outputCentsPerMTok).toBe(0); // garbage -> 0
    expect(p.sidecarCentsPerMinute).toBe(0); // negative -> 0
    expect(p.falCentsByModel).toEqual({ "fal-ai/hunyuan3d/v2": 16 });
    expect(p.modelOverrides).toEqual({}); // malformed JSON -> price as 0
  });
});

describe("computeCostCents", () => {
  it("prices token components per million tokens", () => {
    // 2.1M input @ 300c/MTok + 0.55M output @ 1500c/MTok = 630 + 825
    const cents = computeCostCents(
      usage,
      prices({ inputCentsPerMTok: 300, outputCentsPerMTok: 1500 })
    );
    expect(cents).toBe(630 + 825);
  });

  it("applies per-model overrides above the global token price", () => {
    const cents = computeCostCents(
      usage,
      prices({
        inputCentsPerMTok: 100,
        modelOverrides: { "claude-sonnet-4-6": { inputCents: 300 } },
      })
    );
    // sonnet 2M @ 300 = 600; haiku 0.1M @ global 100 = 10
    expect(cents).toBe(610);
  });

  it("prices sidecar minutes and fal calls (per-model map beats default)", () => {
    const cents = computeCostCents(
      usage,
      prices({
        sidecarCentsPerMinute: 5,
        falCentsPerCall: 1,
        falCentsByModel: { "fal-ai/hunyuan3d/v2": 16 },
      })
    );
    // sidecar 2min*5 = 10; flux 1*1 = 1; hunyuan 2*16 = 32
    expect(cents).toBe(10 + 1 + 32);
  });

  it("accumulates fractional cents before rounding once at the end", () => {
    // 1.5k tokens @ 300c/MTok = 0.45¢ each; three roles = 1.35¢ -> 1¢
    const u: CadUsageSummary = {
      v: 1,
      model: ["a", "b", "c"].map((role) => ({
        role,
        model: "m",
        calls: 1,
        inputTokens: 1_500,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        ms: 0,
      })),
      sidecar: { calls: 0, ms: 0 },
      fal: [],
    };
    const cents = computeCostCents(u, prices({ inputCentsPerMTok: 300 }));
    expect(cents).toBe(1); // per-component rounding would have given 0
  });

  it("recomputes history: same usage, new prices, new answer", () => {
    const yesterday = computeCostCents(usage, prices());
    const today = computeCostCents(
      usage,
      prices({ inputCentsPerMTok: 300, outputCentsPerMTok: 1500 })
    );
    expect(yesterday).toBe(0);
    expect(today).toBeGreaterThan(0);
  });

  it("handles null/undefined and pre-metering rows as 0", () => {
    expect(computeCostCents(null)).toBe(0);
    expect(computeCostCents(undefined)).toBe(0);
  });
});
