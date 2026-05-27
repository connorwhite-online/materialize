import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REQUIRED_SERVER_ENV, requireEnv } from "../env";

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
});
