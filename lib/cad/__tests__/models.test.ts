import { describe, it, expect, afterEach } from "vitest";
import {
  cadRoleOrDefault,
  modelForRole,
  modelParamsForRole,
  openaiParamsForRole,
  planStepEnabled,
  providerForRole,
} from "@/lib/cad/models";

const ENV_KEYS = [
  "CAD_MODEL_PLAN",
  "CAD_MODEL_IMPLEMENT",
  "CAD_MODEL_TITLE",
  "CAD_MODEL_DEFAULT",
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
