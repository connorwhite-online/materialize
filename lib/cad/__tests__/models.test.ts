import { describe, it, expect, afterEach } from "vitest";
import { modelForRole, planStepEnabled } from "@/lib/cad/models";

const ENV_KEYS = [
  "CAD_MODEL_PLAN",
  "CAD_MODEL_IMPLEMENT",
  "CAD_MODEL_DEFAULT",
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

describe("modelForRole", () => {
  it("defaults to undefined (SDK default — the strong model) when nothing is set", () => {
    delete process.env.CAD_MODEL_PLAN;
    delete process.env.CAD_MODEL_DEFAULT;
    expect(modelForRole("plan")).toBeUndefined();
  });

  it("uses CAD_MODEL_DEFAULT as the fallback for every role", () => {
    delete process.env.CAD_MODEL_IMPLEMENT;
    process.env.CAD_MODEL_DEFAULT = "strong-model";
    expect(modelForRole("implement")).toBe("strong-model");
    expect(modelForRole("plan")).toBe("strong-model");
  });

  it("prefers the role-specific override over the default", () => {
    process.env.CAD_MODEL_DEFAULT = "strong-model";
    process.env.CAD_MODEL_PLAN = "cheap-planner";
    expect(modelForRole("plan")).toBe("cheap-planner");
    expect(modelForRole("implement")).toBe("strong-model"); // unchanged
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
