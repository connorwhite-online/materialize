import { describe, it, expect } from "vitest";
import {
  decideEnvironmentDispatch,
  readEnvironment,
  isSharedSecretModeEnabled,
  checkSharedSecretFreshness,
} from "../route";

describe("readEnvironment", () => {
  it("returns the environment string when set", () => {
    expect(readEnvironment({ environment: "production" })).toBe("production");
  });

  it("returns null when the field is missing", () => {
    expect(readEnvironment({})).toBeNull();
  });

  it("returns null when the field is not a string", () => {
    expect(readEnvironment({ environment: 123 })).toBeNull();
    expect(readEnvironment({ environment: null })).toBeNull();
    expect(readEnvironment({ environment: {} })).toBeNull();
  });

  it("trims whitespace and treats empty as null", () => {
    expect(readEnvironment({ environment: "  staging  " })).toBe("staging");
    expect(readEnvironment({ environment: "   " })).toBeNull();
  });
});

describe("decideEnvironmentDispatch", () => {
  it("defaults to production-only when no config is set", () => {
    const prod = decideEnvironmentDispatch("production", undefined);
    expect(prod.dispatch).toBe(true);
    expect(prod.allowed).toEqual(["production"]);

    const dev = decideEnvironmentDispatch("development", undefined);
    expect(dev.dispatch).toBe(false);
    if (!dev.dispatch) {
      expect(dev.reason).toBe("non-allowed-environment");
    }
  });

  it("skips events with no environment tag by default — guards against hand-crafted payloads firing real runs", () => {
    const decision = decideEnvironmentDispatch(null, undefined);
    expect(decision.dispatch).toBe(false);
    if (!decision.dispatch) {
      expect(decision.reason).toBe("missing-environment");
    }
  });

  it("'*' wildcard dispatches regardless of environment, including when missing", () => {
    expect(decideEnvironmentDispatch("development", "*").dispatch).toBe(true);
    expect(decideEnvironmentDispatch("staging", "*").dispatch).toBe(true);
    expect(decideEnvironmentDispatch(null, "*").dispatch).toBe(true);
  });

  it("comma-separated list allows multiple environments", () => {
    const staging = decideEnvironmentDispatch(
      "staging",
      "production,staging"
    );
    expect(staging.dispatch).toBe(true);
    expect(staging.allowed).toEqual(["production", "staging"]);

    const dev = decideEnvironmentDispatch(
      "development",
      "production,staging"
    );
    expect(dev.dispatch).toBe(false);
  });

  it("environment matching is case-insensitive on both sides", () => {
    expect(
      decideEnvironmentDispatch("Production", "production").dispatch
    ).toBe(true);
    expect(
      decideEnvironmentDispatch("production", "PRODUCTION").dispatch
    ).toBe(true);
  });

  it("strips whitespace from individual config entries", () => {
    const decision = decideEnvironmentDispatch(
      "staging",
      "production, staging , preview"
    );
    expect(decision.dispatch).toBe(true);
    expect(decision.allowed).toEqual(["production", "staging", "preview"]);
  });

  it("treats empty config string as the default (production)", () => {
    const decision = decideEnvironmentDispatch("production", "");
    expect(decision.dispatch).toBe(true);
    expect(decision.allowed).toEqual(["production"]);
  });
});

describe("isSharedSecretModeEnabled", () => {
  it("is OFF by default (unset / empty) so production stays HMAC-only", () => {
    expect(isSharedSecretModeEnabled(undefined)).toBe(false);
    expect(isSharedSecretModeEnabled("")).toBe(false);
    expect(isSharedSecretModeEnabled("   ")).toBe(false);
  });

  it("accepts the usual truthy spellings, case/space-insensitively", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) {
      expect(isSharedSecretModeEnabled(v)).toBe(true);
    }
  });

  it("treats other values as disabled (fail closed)", () => {
    for (const v of ["0", "false", "no", "off", "enabled", "2"]) {
      expect(isSharedSecretModeEnabled(v)).toBe(false);
    }
  });
});

describe("checkSharedSecretFreshness", () => {
  const now = 1_700_000_000_000; // fixed nowMs
  const nowSeconds = Math.floor(now / 1000);

  it("rejects a missing or empty timestamp header", () => {
    expect(checkSharedSecretFreshness(null, undefined, now)).toEqual({
      ok: false,
      reason: "missing-timestamp",
    });
    expect(checkSharedSecretFreshness("   ", undefined, now)).toEqual({
      ok: false,
      reason: "missing-timestamp",
    });
  });

  it("rejects a non-numeric or non-positive timestamp", () => {
    expect(checkSharedSecretFreshness("nope", undefined, now).ok).toBe(false);
    expect(
      (checkSharedSecretFreshness("abc", undefined, now) as { reason: string })
        .reason
    ).toBe("malformed-timestamp");
    expect(checkSharedSecretFreshness("0", undefined, now).ok).toBe(false);
    expect(checkSharedSecretFreshness("-5", undefined, now).ok).toBe(false);
  });

  it("accepts a fresh timestamp in seconds within the default window", () => {
    expect(
      checkSharedSecretFreshness(String(nowSeconds), undefined, now).ok
    ).toBe(true);
    // 299s ago — inside the 300s default
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 299), undefined, now).ok
    ).toBe(true);
  });

  it("accepts a fresh timestamp in milliseconds", () => {
    expect(checkSharedSecretFreshness(String(now), undefined, now).ok).toBe(
      true
    );
  });

  it("rejects a timestamp older than the window as a replay", () => {
    const stale = checkSharedSecretFreshness(
      String(nowSeconds - 301),
      undefined,
      now
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale-timestamp");
  });

  it("rejects a future timestamp beyond the window (clock-skew bound)", () => {
    expect(
      checkSharedSecretFreshness(String(nowSeconds + 1000), undefined, now).ok
    ).toBe(false);
  });

  it("honors a custom window override", () => {
    // 500s ago: stale under default 300, fresh under a 600s window
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 500), undefined, now).ok
    ).toBe(false);
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 500), "600", now).ok
    ).toBe(true);
  });

  it("falls back to the default window when the override is invalid", () => {
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 299), "garbage", now).ok
    ).toBe(true);
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 301), "0", now).ok
    ).toBe(false);
  });
});
