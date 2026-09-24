import { describe, it, expect, afterEach } from "vitest";
import {
  cadRoleOrDefault,
  modelForRole,
  modelParamsForRole,
  openaiParamsForRole,
  planStepEnabled,
  providerForRole,
  effortBelow,
  ladderEffort,
} from "@/lib/cad/models";
import { runWithCadTier } from "@/lib/cad/budget";

const ENV_KEYS = [
  "CAD_MODEL_PLAN",
  "CAD_MODEL_IMPLEMENT",
  "CAD_MODEL_TITLE",
  "CAD_MODEL_DEFAULT",
  "CAD_MODEL_BLOCKOUT",
  "CAD_EFFORT_BLOCKOUT",
  "CAD_EFFORT_IMPLEMENT",
  "CAD_EFFORT_DEFAULT",
  "CAD_PLAN_STEP",
  // Provider selection reads these, so they have to be cleared too or the
  // defaults under test depend on whoever's shell is running the suite.
  "CAD_PROVIDER",
  "OAI_SECRET_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("modelForRole", () => {
  it("resolves every role to a concrete current-generation model when nothing is set", () => {
    clearEnv();
    expect(modelForRole("plan")).toBe("claude-opus-5");
    expect(modelForRole("implement")).toBe("claude-opus-5");
    expect(modelForRole("repair")).toBe("claude-opus-5");
    expect(modelForRole("title")).toBe("claude-haiku-4-5");
  });

  it("keeps the judge on a different model than the generator by default", () => {
    // The self-preference mitigation recorded in lib/cad/critique.ts is only
    // real if these two differ — it was inert while every role shared one id.
    clearEnv();
    expect(modelForRole("critique")).not.toBe(modelForRole("implement"));
  });

  it("uses CAD_MODEL_DEFAULT as the fallback for every role", () => {
    clearEnv();
    process.env.CAD_MODEL_DEFAULT = "strong-model";
    expect(modelForRole("implement")).toBe("strong-model");
    expect(modelForRole("plan")).toBe("strong-model");
  });

  it("prefers the role-specific override over the default", () => {
    clearEnv();
    process.env.CAD_MODEL_DEFAULT = "strong-model";
    process.env.CAD_MODEL_PLAN = "cheap-planner";
    expect(modelForRole("plan")).toBe("cheap-planner");
    expect(modelForRole("implement")).toBe("strong-model"); // unchanged
  });
});

describe("modelParamsForRole", () => {
  it("spends the deepest effort on the roles that write geometry", () => {
    clearEnv();
    expect(modelParamsForRole("implement")).toEqual({
      model: "claude-opus-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
    });
    expect(modelParamsForRole("repair").output_config?.effort).toBe("xhigh");
    expect(modelParamsForRole("plan").output_config?.effort).toBe("medium");
  });

  it("drops both knobs for a model that rejects them", () => {
    // Haiku 4.5 takes budget_tokens and 400s on `adaptive` / effort — a
    // CAD_MODEL_* override must degrade, not break the call.
    clearEnv();
    expect(modelParamsForRole("title")).toEqual({ model: "claude-haiku-4-5" });
  });

  it("gates the knobs on a PINNED model, not the role's default", () => {
    clearEnv();
    // plan's default (Opus) takes adaptive thinking; a Haiku pin must not
    // inherit it: Haiku 4.5 rejects `adaptive`, and this is how every concept
    // blockout would have 400'd in production.
    expect(modelParamsForRole("plan", undefined, "claude-haiku-4-5-20251001")).toEqual({
      model: "claude-haiku-4-5-20251001",
    });
    // and the reverse: an Opus pin on a Haiku role gets its knobs
    expect(modelParamsForRole("title", undefined, "claude-opus-5-5")).toEqual({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    expect(openaiParamsForRole("plan", undefined, "some-future-model")).toEqual({
      model: "some-future-model",
    });
  });

  it("runs concept blockouts on Opus at low effort, overridable per env", () => {
    clearEnv();
    expect(modelParamsForRole("blockout")).toEqual({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    process.env.CAD_MODEL_BLOCKOUT = "claude-haiku-4-5-20251001";
    expect(modelParamsForRole("blockout")).toEqual({ model: "claude-haiku-4-5-20251001" });
    process.env.CAD_MODEL_BLOCKOUT = "claude-opus-5-5";
    process.env.CAD_EFFORT_BLOCKOUT = "medium";
    expect(modelParamsForRole("blockout").output_config?.effort).toBe("medium");
  });

  it("drops both knobs for a model id it does not recognize", () => {
    clearEnv();
    process.env.CAD_MODEL_IMPLEMENT = "some-future-model";
    expect(modelParamsForRole("implement")).toEqual({
      model: "some-future-model",
    });
  });

  it("clamps xhigh to high on models that predate it", () => {
    clearEnv();
    process.env.CAD_MODEL_IMPLEMENT = "claude-opus-4-6";
    const params = modelParamsForRole("implement");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
  });

  it("honors an effort override and ignores a nonsense one", () => {
    clearEnv();
    process.env.CAD_EFFORT_IMPLEMENT = "low";
    expect(modelParamsForRole("implement").output_config?.effort).toBe("low");
    process.env.CAD_EFFORT_IMPLEMENT = "turbo";
    expect(modelParamsForRole("implement").output_config?.effort).toBe("xhigh");
  });

  it("falls back to CAD_EFFORT_DEFAULT before the role default", () => {
    clearEnv();
    process.env.CAD_EFFORT_DEFAULT = "max";
    expect(modelParamsForRole("plan").output_config?.effort).toBe("max");
    process.env.CAD_EFFORT_IMPLEMENT = "medium";
    expect(modelParamsForRole("implement").output_config?.effort).toBe("medium");
  });
});

describe("cadRoleOrDefault", () => {
  it("passes real roles through and maps non-roles to plan", () => {
    expect(cadRoleOrDefault("critique")).toBe("critique");
    expect(cadRoleOrDefault("route")).toBe("plan");
    expect(cadRoleOrDefault(undefined)).toBe("plan");
  });
});

describe("planStepEnabled", () => {
  it("is on by default and only 'false' disables it", () => {
    delete process.env.CAD_PLAN_STEP;
    expect(planStepEnabled()).toBe(true);
    process.env.CAD_PLAN_STEP = "true";
    expect(planStepEnabled()).toBe(true);
    process.env.CAD_PLAN_STEP = "false";
    expect(planStepEnabled()).toBe(false);
  });
});

describe("provider selection", () => {
  it("defaults every role to Claude with only an Anthropic key", () => {
    clearEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(providerForRole("implement")).toBe("anthropic");
    expect(modelForRole("implement")).toBe("claude-opus-5");
  });

  it("defaults every role to OpenAI once an OpenAI key is present", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(providerForRole("implement")).toBe("openai");
    expect(modelForRole("implement")).toBe("gpt-6-astra");
    expect(modelForRole("plan")).toBe("gpt-6-astra");
    expect(modelForRole("title")).toBe("gpt-5.6-luna");
  });

  it("lets CAD_PROVIDER pin the vendor when both keys are set", () => {
    clearEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(modelForRole("implement")).toBe("gpt-6-astra");
    process.env.CAD_PROVIDER = "anthropic";
    expect(modelForRole("implement")).toBe("claude-opus-5");
  });

  it("keeps the judge off the generator's model on OpenAI too", () => {
    // Same self-preference mitigation as the Claude defaults — it has to hold
    // within a single-vendor deployment, not just across vendors.
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(modelForRole("critique")).not.toBe(modelForRole("implement"));
  });

  it("follows a per-role override across vendors", () => {
    clearEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.CAD_MODEL_IMPLEMENT = "gpt-6-astra";
    expect(providerForRole("implement")).toBe("openai");
    expect(providerForRole("plan")).toBe("anthropic");
  });
});

describe("openaiParamsForRole", () => {
  it("sends the role's effort as reasoning.effort", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(openaiParamsForRole("implement")).toEqual({
      model: "gpt-6-astra",
      reasoning: { effort: "xhigh" },
    });
  });

  it("honours the same effort env vars as the Claude path", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    process.env.CAD_EFFORT_IMPLEMENT = "medium";
    expect(openaiParamsForRole("implement").reasoning?.effort).toBe("medium");
  });

  it("clamps the top rungs for models that do not offer them", () => {
    // Luna is the cheap tier; xhigh/max are flagship-only, and a 400 here
    // would fail the whole title step rather than just costing less.
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    process.env.CAD_EFFORT_TITLE = "max";
    expect(openaiParamsForRole("title").reasoning?.effort).toBe("high");
    process.env.CAD_EFFORT_IMPLEMENT = "max";
    expect(openaiParamsForRole("implement").reasoning?.effort).toBe("max");
  });

  it("sends no reasoning knob for a non-reasoning or unknown id", () => {
    clearEnv();
    process.env.CAD_MODEL_IMPLEMENT = "gpt-4o";
    expect(openaiParamsForRole("implement")).toEqual({ model: "gpt-4o" });
    process.env.CAD_MODEL_IMPLEMENT = "gpt-5-chat-latest";
    expect(openaiParamsForRole("implement")).toEqual({
      model: "gpt-5-chat-latest",
    });
  });
});

describe("effort ladder", () => {
  afterEach(() => {
    delete process.env.CAD_EFFORT_LADDER_START;
  });

  it("drafts at medium and climbs one level per repair, up to the role's effort", () => {
    // implement/repair default to xhigh with no tier active.
    expect(ladderEffort("implement", 1)).toBe("medium");
    expect(ladderEffort("repair", 2)).toBe("high");
    expect(ladderEffort("repair", 3)).toBe("xhigh");
    expect(ladderEffort("repair", 4)).toBe("xhigh");
  });

  it("never climbs above the tier's cap", () => {
    expect(runWithCadTier("simple", () => ladderEffort("repair", 4))).toBe("medium");
  });

  it("can start elsewhere, or be switched off", () => {
    process.env.CAD_EFFORT_LADDER_START = "low";
    expect(ladderEffort("implement", 1)).toBe("low");
    process.env.CAD_EFFORT_LADDER_START = "off";
    expect(ladderEffort("implement", 1)).toBe("xhigh");
  });

  it("effortBelow steps down one level and bottoms out", () => {
    expect(effortBelow("xhigh")).toBe("high");
    expect(effortBelow("low")).toBe("low");
  });

  it("a cap only ever lowers effort", () => {
    // title defaults to low; a higher cap must not raise it.
    expect(modelParamsForRole("title", "max").output_config?.effort ?? "low").toBe("low");
  });
});
