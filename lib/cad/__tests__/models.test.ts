import { describe, it, expect, afterEach } from "vitest";
import {
  cadRoleOrDefault,
  modelForRole,
  modelParamsForRole,
  planStepEnabled,
} from "@/lib/cad/models";

const ENV_KEYS = [
  "CAD_MODEL_PLAN",
  "CAD_MODEL_IMPLEMENT",
  "CAD_MODEL_TITLE",
  "CAD_MODEL_DEFAULT",
  "CAD_EFFORT_IMPLEMENT",
  "CAD_EFFORT_DEFAULT",
  "CAD_PLAN_STEP",
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
