import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  activeCadTier,
  attemptBudget,
  toolTurnBudget,
  activeTierBudget,
  budgetExhausted,
  runWithCadTier,
  tierBudget,
  tierForRoute,
  tokenCeiling,
  tokenCeilingForTier,
  tokensSpent,
} from "@/lib/cad/budget";
import { CadMeter, runWithCadContext } from "@/lib/cad/metering";
import { modelParamsForRole, openaiParamsForRole } from "@/lib/cad/models";

// Every knob this module reads, cleared around each test so one case's env
// can't decide another's outcome.
const ENV_KEYS = [
  "CAD_ADAPTIVE_BUDGETS",
  "CAD_EFFORT_DEFAULT",
  "CAD_EFFORT_IMPLEMENT",
  "CAD_EFFORT_TITLE",
  "CAD_MAX_TOKENS_PER_JOB",
  "CAD_MAX_TOKENS_SIMPLE",
  "CAD_MAX_TOKENS_COMPLEX",
  "CAD_MAX_TOKENS_ORGANIC",
  "CAD_MODEL_IMPLEMENT",
  "CAD_MODEL_TITLE",
];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  // Pin the models so the effort assertions don't depend on which vendor the
  // test environment happens to be credentialed for.
  process.env.CAD_MODEL_IMPLEMENT = "claude-opus-5";
  process.env.CAD_MODEL_TITLE = "claude-opus-5";
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const effortOf = (role: "implement" | "title") =>
  modelParamsForRole(role).output_config?.effort;

describe("tier context", () => {
  it("is inactive outside a tiered run", () => {
    expect(activeCadTier()).toBeUndefined();
    expect(activeTierBudget()).toBeUndefined();
  });

  it("propagates across awaits, which is what the orchestrator relies on", async () => {
    const seen = await runWithCadTier("complex", async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return activeCadTier();
    });
    expect(seen).toBe("complex");
    // ...and does not leak back out.
    expect(activeCadTier()).toBeUndefined();
  });

  it("CAD_ADAPTIVE_BUDGETS=false disables tiering wholesale", () => {
    process.env.CAD_ADAPTIVE_BUDGETS = "false";
    runWithCadTier("simple", () => {
      expect(activeCadTier()).toBeUndefined();
      expect(activeTierBudget()).toBeUndefined();
    });
  });
});

describe("effort clamping", () => {
  it("lowers a dear role to the tier cap on a simple part", () => {
    // implement defaults to xhigh — the whole point of the simple tier.
    expect(effortOf("implement")).toBe("xhigh");
    runWithCadTier("simple", () => {
      expect(effortOf("implement")).toBe("medium");
    });
  });

  it("leaves the complex tier at the table defaults", () => {
    runWithCadTier("complex", () => {
      expect(effortOf("implement")).toBe("xhigh");
    });
  });

  it("never RAISES a role that is already cheaper than the cap", () => {
    // title defaults to low; complex's cap is "max" and must not promote it.
    runWithCadTier("complex", () => {
      expect(effortOf("title")).toBe("low");
    });
    runWithCadTier("simple", () => {
      expect(effortOf("title")).toBe("low");
    });
  });

  it("yields to an explicit per-role env — stated intent beats the heuristic", () => {
    process.env.CAD_EFFORT_IMPLEMENT = "xhigh";
    runWithCadTier("simple", () => {
      expect(effortOf("implement")).toBe("xhigh");
    });
  });

  it("yields to CAD_EFFORT_DEFAULT too", () => {
    process.env.CAD_EFFORT_DEFAULT = "high";
    runWithCadTier("simple", () => {
      expect(effortOf("implement")).toBe("high");
    });
  });

  it("applies to the OpenAI reasoning knob as well", () => {
    process.env.CAD_MODEL_IMPLEMENT = "gpt-6-astra";
    expect(openaiParamsForRole("implement").reasoning?.effort).toBe("xhigh");
    runWithCadTier("simple", () => {
      expect(openaiParamsForRole("implement").reasoning?.effort).toBe("medium");
    });
  });

  it("is a no-op when adaptive budgets are off", () => {
    process.env.CAD_ADAPTIVE_BUDGETS = "false";
    runWithCadTier("simple", () => {
      expect(effortOf("implement")).toBe("xhigh");
    });
  });
});

describe("tier budgets", () => {
  it("gives a simple part strictly less room than a complex one", () => {
    const simple = tierBudget("simple");
    const complex = tierBudget("complex");
    expect(simple.maxAttempts).toBeLessThan(complex.maxAttempts);
    expect(simple.maxToolTurns).toBeLessThan(complex.maxToolTurns);
    expect(simple.agenticMaxMs).toBeLessThan(complex.agenticMaxMs);
    expect(simple.maxTokens).toBeLessThan(complex.maxTokens);
  });

  it("keeps the complex tier at the constants it was tuned with", () => {
    // These are the pre-tier defaults in agentic.ts / harness.ts. A complex
    // part must behave exactly as it did before tiering existed.
    const complex = tierBudget("complex");
    expect(complex.agenticMaxMs).toBe(600_000);
    expect(complex.maxToolTurns).toBe(16);
    expect(complex.maxAttempts).toBe(4);
    expect(complex.effortCap).toBe("max");
  });
});

describe("token ceiling", () => {
  it("uses the tier default", () => {
    runWithCadTier("simple", () => {
      expect(tokenCeiling()).toBe(tierBudget("simple").maxTokens);
    });
  });

  it("prefers a per-tier override", () => {
    process.env.CAD_MAX_TOKENS_SIMPLE = "1234";
    runWithCadTier("simple", () => expect(tokenCeiling()).toBe(1234));
    // ...and only for that tier.
    runWithCadTier("complex", () =>
      expect(tokenCeiling()).toBe(tierBudget("complex").maxTokens)
    );
  });

  it("lets the global override win over every tier", () => {
    process.env.CAD_MAX_TOKENS_PER_JOB = "99";
    process.env.CAD_MAX_TOKENS_SIMPLE = "1234";
    runWithCadTier("simple", () => expect(tokenCeiling()).toBe(99));
    runWithCadTier("complex", () => expect(tokenCeiling()).toBe(99));
  });

  it("is unbounded outside a tier unless the operator sets the global cap", () => {
    expect(tokenCeiling()).toBeUndefined();
    process.env.CAD_MAX_TOKENS_PER_JOB = "77";
    expect(tokenCeiling()).toBe(77);
  });

  it("ignores a junk or non-positive override rather than capping at zero", () => {
    for (const bad of ["0", "-5", "lots", ""]) {
      process.env.CAD_MAX_TOKENS_SIMPLE = bad;
      runWithCadTier("simple", () =>
        expect(tokenCeiling()).toBe(tierBudget("simple").maxTokens)
      );
    }
  });

  it("still honors the global cap when tiering is switched off", () => {
    process.env.CAD_ADAPTIVE_BUDGETS = "false";
    process.env.CAD_MAX_TOKENS_PER_JOB = "42";
    runWithCadTier("simple", () => expect(tokenCeiling()).toBe(42));
  });

  it("drops tier ceilings when tiering is switched off", () => {
    process.env.CAD_ADAPTIVE_BUDGETS = "false";
    expect(tokenCeilingForTier("simple")).toBeUndefined();
  });
});

describe("tierForRoute", () => {
  it.each([
    ["simple", "simple"],
    ["simple-bestof3", "simple"],
    ["complex", "complex"],
    ["complex-fallback", "complex"],
    ["complex-salvage", "complex"],
    ["organic", "organic"],
  ] as const)("maps %s to the %s tier", (route, tier) => {
    expect(tierForRoute(route)).toBe(tier);
  });

  it.each(["legacy", "legacy-bestof2", "legacy-generative", "", undefined])(
    "leaves %s untiered",
    (route) => {
      expect(tierForRoute(route)).toBeUndefined();
    }
  );
});

describe("spend tracking", () => {
  const spend = (inputTokens: number, outputTokens: number) => ({
    role: "implement",
    model: "claude-opus-5",
    inputTokens,
    outputTokens,
    ms: 1,
  });

  it("reads zero with no active meter, so scripts and evals are unaffected", () => {
    expect(tokensSpent()).toBe(0);
    runWithCadTier("simple", () => expect(budgetExhausted()).toBe(false));
  });

  it("sums input and output across roles", () => {
    const meter = new CadMeter();
    runWithCadContext({ meter }, () => {
      meter.recordModelUsage(spend(100, 50));
      meter.recordModelUsage({ ...spend(10, 5), role: "critique" });
      expect(tokensSpent()).toBe(165);
    });
  });

  it("excludes cache traffic — a well-cached run must not trip the cap early", () => {
    const meter = new CadMeter();
    runWithCadContext({ meter }, () => {
      meter.recordModelUsage({
        ...spend(100, 50),
        cacheReadTokens: 900_000,
        cacheWriteTokens: 500_000,
      });
      expect(tokensSpent()).toBe(150);
    });
  });

  it("reports exhaustion only once the ceiling is reached", () => {
    process.env.CAD_MAX_TOKENS_SIMPLE = "1000";
    const meter = new CadMeter();
    runWithCadContext({ meter }, () =>
      runWithCadTier("simple", () => {
        meter.recordModelUsage(spend(600, 300));
        expect(budgetExhausted()).toBe(false);
        meter.recordModelUsage(spend(100, 0));
        expect(budgetExhausted()).toBe(true);
      })
    );
  });

  it("never reports exhaustion without a ceiling", () => {
    const meter = new CadMeter();
    runWithCadContext({ meter }, () => {
      meter.recordModelUsage(spend(10_000_000, 10_000_000));
      expect(budgetExhausted()).toBe(false);
    });
  });
});

describe("attempt and tool-turn overrides", () => {
  const KEYS = ["CAD_MAX_ATTEMPTS", "CAD_MAX_TOOL_TURNS"];
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("falls back to the tier's own figures", () => {
    runWithCadTier("simple", () => {
      expect(attemptBudget()).toBe(tierBudget("simple").maxAttempts);
      expect(toolTurnBudget()).toBe(tierBudget("simple").maxToolTurns);
    });
  });

  it("lets a global override win, so a tight tier needn't be switched off entirely", () => {
    process.env.CAD_MAX_ATTEMPTS = "6";
    process.env.CAD_MAX_TOOL_TURNS = "24";
    runWithCadTier("simple", () => {
      expect(attemptBudget()).toBe(6);
      expect(toolTurnBudget()).toBe(24);
    });
  });

  it("is undefined with no tier, leaving the caller's own default in place", () => {
    expect(attemptBudget()).toBeUndefined();
    expect(toolTurnBudget()).toBeUndefined();
  });
});
