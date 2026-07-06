import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  byokEnabled,
  platformModelCredentials,
  resolveModelCredentials,
} from "@/lib/cad/credentials";

const ENV_KEYS = [
  "CAD_BYOK_ENABLED",
  "CAD_BYOK_STUB_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("byokEnabled", () => {
  it("defaults OFF and only the exact string 'true' enables it", () => {
    expect(byokEnabled()).toBe(false);
    process.env.CAD_BYOK_ENABLED = "1";
    expect(byokEnabled()).toBe(false);
    process.env.CAD_BYOK_ENABLED = "true";
    expect(byokEnabled()).toBe(true);
  });
});

describe("resolveModelCredentials", () => {
  it("returns platform credentials when BYOK is off, even with a stub key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    process.env.CAD_BYOK_STUB_KEY = "sk-user";
    const creds = await resolveModelCredentials("user-1");
    expect(creds).toEqual({ source: "platform", apiKey: "sk-platform" });
  });

  it("prefers the user key when BYOK is on and a key resolves", async () => {
    process.env.CAD_BYOK_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    process.env.CAD_BYOK_STUB_KEY = "sk-user";
    const creds = await resolveModelCredentials("user-1");
    expect(creds).toEqual({ source: "user", apiKey: "sk-user" });
  });

  it("falls back to platform when BYOK is on but no user key exists", async () => {
    process.env.CAD_BYOK_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    const creds = await resolveModelCredentials("user-1");
    expect(creds.source).toBe("platform");
    expect(creds.apiKey).toBe("sk-platform");
  });

  it("never returns a user key without a userId", async () => {
    process.env.CAD_BYOK_ENABLED = "true";
    process.env.CAD_BYOK_STUB_KEY = "sk-user";
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    const creds = await resolveModelCredentials(null);
    expect(creds.source).toBe("platform");
  });

  it("platform credentials mirror the model-client env priority (API key first, OAuth fallback)", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-token";
    expect(platformModelCredentials()).toEqual({
      source: "platform",
      authToken: "oauth-token",
    });
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    expect(platformModelCredentials()).toEqual({
      source: "platform",
      apiKey: "sk-platform",
    });
  });
});
