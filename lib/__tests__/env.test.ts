import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REQUIRED_SERVER_ENV,
  requireEnv,
  isCadRunnerMock,
  isSandboxMode,
} from "../env";

// A complete, valid set of all required server vars, layered over a clean
// base (preserving NODE_ENV etc. that ProcessEnv requires).
function validEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of REQUIRED_SERVER_ENV) {
    env[key] = `test-${key}`;
  }
  return env;
}

describe("requireEnv", () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it("returns the value when set", () => {
    process.env.SOME_VAR = "hello";
    expect(requireEnv("SOME_VAR")).toBe("hello");
  });

  it("throws a clear error when missing", () => {
    delete process.env.SOME_VAR;
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
  });

  it("throws when empty string", () => {
    process.env.SOME_VAR = "";
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
  });
});

describe("validateServerEnv", () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  // The validator memoizes on success, so reset the module registry per-test
  // to get a clean module-level cache.
  async function freshValidate() {
    vi.resetModules();
    return (await import("../env")) as typeof import("../env");
  }

  it("passes and returns a typed accessor when all required vars present", async () => {
    process.env = { ...validEnv() };
    const { validateServerEnv, serverEnv } = await freshValidate();
    const env = validateServerEnv();
    expect(env.DATABASE_URL).toBe("test-DATABASE_URL");
    expect(serverEnv("STRIPE_SECRET_KEY")).toBe("test-STRIPE_SECRET_KEY");
  });

  it("throws EnvValidationError listing every missing var", async () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    delete env.WATERMARK_SECRET;
    process.env = { ...env };

    const mod = await freshValidate();
    try {
      mod.validateServerEnv();
      throw new Error("expected validateServerEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(mod.EnvValidationError);
      const missing = (err as InstanceType<typeof mod.EnvValidationError>)
        .missing;
      expect(missing).toContain("DATABASE_URL");
      expect(missing).toContain("WATERMARK_SECRET");
      expect(missing).not.toContain("STRIPE_SECRET_KEY");
    }
  });

  it("treats empty string as missing", async () => {
    const env = validEnv();
    env.CRON_SECRET = "";
    process.env = { ...env };

    const mod = await freshValidate();
    expect(() => mod.validateServerEnv()).toThrow(mod.EnvValidationError);
  });

  // SEC-4: a real (non-mock) CAD_RUNNER_URL must not boot without
  // CAD_RUNNER_SECRET — otherwise every sidecar request goes out
  // unauthenticated (lib/cad/runner-client.ts, lib/cad/session-client.ts).
  describe("CAD_RUNNER_SECRET required-when-live rule", () => {
    it("throws when CAD_RUNNER_URL is live and CAD_RUNNER_SECRET is missing", async () => {
      const env = validEnv();
      env.CAD_RUNNER_URL = "https://runner.example.com";
      delete env.CAD_RUNNER_SECRET;
      delete env.CAD_RUNNER_USE_MOCK;
      process.env = { ...env };

      const mod = await freshValidate();
      try {
        mod.validateServerEnv();
        throw new Error("expected validateServerEnv to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(mod.EnvValidationError);
        const missing = (err as InstanceType<typeof mod.EnvValidationError>)
          .missing;
        expect(missing).toContain("CAD_RUNNER_SECRET");
      }
    });

    it("passes when CAD_RUNNER_URL is live and CAD_RUNNER_SECRET is set", async () => {
      const env = validEnv();
      env.CAD_RUNNER_URL = "https://runner.example.com";
      env.CAD_RUNNER_SECRET = "shh-its-a-secret";
      delete env.CAD_RUNNER_USE_MOCK;
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).not.toThrow();
    });

    it("passes when CAD_RUNNER_URL is unset (mock mode) even without CAD_RUNNER_SECRET", async () => {
      const env = validEnv();
      delete env.CAD_RUNNER_URL;
      delete env.CAD_RUNNER_SECRET;
      delete env.CAD_RUNNER_USE_MOCK;
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).not.toThrow();
    });

    it("passes when CAD_RUNNER_USE_MOCK=true forces mock mode, even with a URL and no secret", async () => {
      const env = validEnv();
      env.CAD_RUNNER_URL = "https://runner.example.com";
      env.CAD_RUNNER_USE_MOCK = "true";
      delete env.CAD_RUNNER_SECRET;
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).not.toThrow();
    });
  });

  // SEC-5: a live Stripe key must never pair with a mocked CraftCloud
  // checkout — lib/craftcloud/client.ts's USE_MOCK defaults ON, so a
  // prod deploy missing CRAFTCLOUD_USE_MOCK=false would take real
  // Stripe money while fabricating craftCloudOrderIds.
  describe("live-Stripe + mocked-CraftCloud boot rule", () => {
    it("throws when Stripe is live and CRAFTCLOUD_USE_MOCK is unset (defaults to mock)", async () => {
      const env = validEnv();
      env.STRIPE_SECRET_KEY = "sk_live_abc123";
      delete env.CRAFTCLOUD_USE_MOCK;
      process.env = { ...env };

      const mod = await freshValidate();
      try {
        mod.validateServerEnv();
        throw new Error("expected validateServerEnv to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(mod.EnvValidationError);
        const missing = (err as InstanceType<typeof mod.EnvValidationError>)
          .missing;
        expect(missing).toContain("CRAFTCLOUD_USE_MOCK");
      }
    });

    it("throws when Stripe is live and CRAFTCLOUD_USE_MOCK is explicitly not \"false\"", async () => {
      const env = validEnv();
      env.STRIPE_SECRET_KEY = "sk_live_abc123";
      env.CRAFTCLOUD_USE_MOCK = "true";
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).toThrow(mod.EnvValidationError);
    });

    it("passes when Stripe is live and CRAFTCLOUD_USE_MOCK is explicitly \"false\"", async () => {
      const env = validEnv();
      env.STRIPE_SECRET_KEY = "sk_live_abc123";
      env.CRAFTCLOUD_USE_MOCK = "false";
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).not.toThrow();
    });

    it("passes when Stripe is a test key regardless of CRAFTCLOUD_USE_MOCK", async () => {
      const env = validEnv();
      env.STRIPE_SECRET_KEY = "sk_test_abc123";
      delete env.CRAFTCLOUD_USE_MOCK;
      process.env = { ...env };

      const mod = await freshValidate();
      expect(() => mod.validateServerEnv()).not.toThrow();
    });
  });
});

// MTR-166: the CAD-runner mock is a sandbox gate and must flip the badge.
describe("isCadRunnerMock", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it("is mocked when CAD_RUNNER_URL is unset/empty", () => {
    delete process.env.CAD_RUNNER_URL;
    expect(isCadRunnerMock()).toBe(true);
    process.env.CAD_RUNNER_URL = "";
    expect(isCadRunnerMock()).toBe(true);
  });

  it("is live when a runner URL is configured", () => {
    process.env.CAD_RUNNER_URL = "https://runner.example.com";
    delete process.env.CAD_RUNNER_USE_MOCK;
    expect(isCadRunnerMock()).toBe(false);
  });

  it("CAD_RUNNER_USE_MOCK=true forces the mock even with a URL", () => {
    process.env.CAD_RUNNER_URL = "https://runner.example.com";
    process.env.CAD_RUNNER_USE_MOCK = "true";
    expect(isCadRunnerMock()).toBe(true);
  });
});

// MTR-166: isSandboxMode() must OR in every mock/test gate (AGENTS.md rule).
describe("isSandboxMode", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  // A fully-live baseline: real Stripe key, CraftCloud live, runner live.
  function liveEnv(): void {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    process.env.CRAFTCLOUD_USE_MOCK = "false";
    process.env.CAD_RUNNER_URL = "https://runner.example.com";
    delete process.env.CAD_RUNNER_USE_MOCK;
  }

  it("is false when nothing is mocked", () => {
    liveEnv();
    expect(isSandboxMode()).toBe(false);
  });

  it("is true on a Stripe test key", () => {
    liveEnv();
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(isSandboxMode()).toBe(true);
  });

  it("is true when CraftCloud is mocked", () => {
    liveEnv();
    process.env.CRAFTCLOUD_USE_MOCK = "true";
    expect(isSandboxMode()).toBe(true);
  });

  it("is true when only the CAD runner is mocked", () => {
    liveEnv();
    delete process.env.CAD_RUNNER_URL;
    expect(isSandboxMode()).toBe(true);
  });
});
