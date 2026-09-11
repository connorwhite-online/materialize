import { describe, it, expect, afterEach } from "vitest";
import {
  defaultProvider,
  hasCredentialsFor,
  openaiApiKey,
  providerForModel,
  usableOpenaiKey,
} from "@/lib/cad/provider";

const ENV = [
  "OAI_SECRET_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CAD_PROVIDER",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clearEnv() {
  for (const k of ENV) delete process.env[k];
}

describe("providerForModel", () => {
  it("routes the OpenAI families, including snapshots", () => {
    for (const id of [
      "gpt-6-astra",
      "gpt-6-astra-2026-09-03",
      "gpt-5.6-sol",
      "gpt-5.4-mini",
      "o3",
      "o4-mini",
      "codex-mini-latest",
      "chatgpt-4o-latest",
    ]) {
      expect(providerForModel(id)).toBe("openai");
    }
  });

  it("leaves everything else on Anthropic, which is where it resolved before", () => {
    for (const id of ["claude-opus-5", "claude-haiku-4-5", "strong-model"]) {
      expect(providerForModel(id)).toBe("anthropic");
    }
  });
});

describe("credential resolution", () => {
  it("accepts either OpenAI variable, preferring this deployment's name", () => {
    clearEnv();
    process.env.OPENAI_API_KEY = "sdk-default";
    expect(openaiApiKey()).toBe("sdk-default");
    process.env.OAI_SECRET_KEY = "deployment";
    expect(openaiApiKey()).toBe("deployment");
  });

  it("reports per-provider credentials independently", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(hasCredentialsFor("openai")).toBe(true);
    expect(hasCredentialsFor("anthropic")).toBe(false);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth";
    expect(hasCredentialsFor("anthropic")).toBe(true);
  });
});

describe("defaultProvider", () => {
  it("falls back to Anthropic with no keys at all — the pre-existing default", () => {
    clearEnv();
    expect(defaultProvider()).toBe("anthropic");
  });

  it("prefers OpenAI when its key is present", () => {
    clearEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    expect(defaultProvider()).toBe("openai");
  });

  it("obeys CAD_PROVIDER over the environment", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "sk-test-000000000000000000";
    process.env.CAD_PROVIDER = "anthropic";
    expect(defaultProvider()).toBe("anthropic");
    process.env.CAD_PROVIDER = "nonsense";
    expect(defaultProvider()).toBe("openai");
  });
});

describe("malformed OpenAI key", () => {
  // Regression: OAI_SECRET_KEY was set to "341193" — the six-character
  // identifier the dashboard prints beside a secret, not the secret. Provider
  // selection keyed off key PRESENCE, so that captured every role and 401ed
  // every generation with no path back to the working vendor.
  const NOT_A_KEY = ["341193", "sk-", "sk-short", "your-key-here", "   "];

  it("is treated as no key at all, so the harness stays on Anthropic", () => {
    for (const value of NOT_A_KEY) {
      clearEnv();
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OAI_SECRET_KEY = value;
      expect(usableOpenaiKey()).toBeUndefined();
      expect(hasCredentialsFor("openai")).toBe(false);
      expect(defaultProvider()).toBe("anthropic");
    }
  });

  it("still reports the raw value, so the operator can be told what is set", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "341193";
    expect(openaiApiKey()).toBe("341193");
  });

  it("yields to an explicit CAD_PROVIDER — stated intent beats a heuristic", () => {
    clearEnv();
    process.env.OAI_SECRET_KEY = "341193";
    process.env.CAD_PROVIDER = "openai";
    expect(defaultProvider()).toBe("openai");
  });

  it("accepts the real key shapes", () => {
    for (const value of [
      "sk-" + "a".repeat(48),
      "sk-proj-" + "b".repeat(64),
      "sk-svcacct-" + "c".repeat(40),
    ]) {
      clearEnv();
      process.env.OAI_SECRET_KEY = value;
      expect(usableOpenaiKey()).toBe(value);
      expect(defaultProvider()).toBe("openai");
    }
  });
});
