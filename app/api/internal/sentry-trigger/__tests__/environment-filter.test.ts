import { describe, it, expect } from "vitest";
import {
  decideEnvironmentDispatch,
  readEnvironment,
  isSharedSecretModeEnabled,
  checkSharedSecretFreshness,
  isActionableSentryDelivery,
  resolveSharedSecretTimestamp,
  readPayloadTimestamp,
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

  it("reads tags.environment from an object map", () => {
    expect(
      readEnvironment({ tags: { environment: "production", release: "abc" } })
    ).toBe("production");
  });

  it("reads environment from a {key,value} tag array", () => {
    expect(
      readEnvironment({
        tags: [
          { key: "release", value: "abc" },
          { key: "environment", value: "production" },
        ],
      })
    ).toBe("production");
  });

  it("prefers the top-level field over tags", () => {
    expect(
      readEnvironment({
        environment: "production",
        tags: { environment: "preview" },
      })
    ).toBe("production");
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

  it("dispatches HMAC-authenticated deliveries with no environment (Internal Integration issue.created)", () => {
    const decision = decideEnvironmentDispatch(null, undefined, {
      allowMissing: true,
    });
    expect(decision.dispatch).toBe(true);
    expect(decision.allowed).toEqual(["production"]);
  });

  it("still filters a present non-allowed environment even when allowMissing is set", () => {
    const decision = decideEnvironmentDispatch("preview", undefined, {
      allowMissing: true,
    });
    expect(decision.dispatch).toBe(false);
    if (!decision.dispatch) {
      expect(decision.reason).toBe("non-allowed-environment");
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

describe("isActionableSentryDelivery", () => {
  it("dispatches issue.created", () => {
    expect(
      isActionableSentryDelivery(
        { action: "created", data: { issue: { id: "1" } } },
        "issue"
      ).dispatch
    ).toBe(true);
  });

  it("skips issue lifecycle actions that are not created", () => {
    for (const action of ["resolved", "assigned", "archived", "unresolved"]) {
      const decision = isActionableSentryDelivery(
        { action, data: { issue: { id: "1" } } },
        "issue"
      );
      expect(decision.dispatch).toBe(false);
      if (!decision.dispatch) {
        expect(decision.reason).toBe("non-actionable-issue-action");
      }
    }
  });

  it("detects an issue envelope from data.issue even without the resource header", () => {
    const decision = isActionableSentryDelivery(
      { action: "resolved", data: { issue: { id: "1" } } },
      null
    );
    expect(decision.dispatch).toBe(false);
  });

  it("skips installation / comment / metric_alert resources", () => {
    for (const resource of ["installation", "comment", "metric_alert"]) {
      const decision = isActionableSentryDelivery({ action: "created" }, resource);
      expect(decision.dispatch).toBe(false);
      if (!decision.dispatch) {
        expect(decision.reason).toBe("non-actionable-resource");
      }
    }
  });

  it("treats a flat event (no action, no resource) as actionable — manual curl", () => {
    expect(
      isActionableSentryDelivery({ event_id: "abc", environment: "production" }, null)
        .dispatch
    ).toBe(true);
  });
});

describe("resolveSharedSecretTimestamp", () => {
  const nowSeconds = "1700000000";

  it("prefers Sentry-Hook-Timestamp over curl and payload", () => {
    const resolved = resolveSharedSecretTimestamp({
      sentryHookTimestamp: nowSeconds,
      curlTimestamp: "1",
      payload: { timestamp: 2 },
      envelope: null,
      allowCurlHeader: true,
    });
    expect(resolved).toEqual({ value: nowSeconds, source: "sentry-hook" });
  });

  it("uses the curl header only when allowed", () => {
    expect(
      resolveSharedSecretTimestamp({
        sentryHookTimestamp: null,
        curlTimestamp: nowSeconds,
        payload: null,
        envelope: null,
        allowCurlHeader: false,
      })
    ).toBeNull();
    expect(
      resolveSharedSecretTimestamp({
        sentryHookTimestamp: null,
        curlTimestamp: nowSeconds,
        payload: null,
        envelope: null,
        allowCurlHeader: true,
      })
    ).toEqual({ value: nowSeconds, source: "curl" });
  });

  it("falls back to the event timestamp so Alert Rules authenticate without a custom header", () => {
    const resolved = resolveSharedSecretTimestamp({
      sentryHookTimestamp: null,
      curlTimestamp: nowSeconds,
      payload: { timestamp: 1_700_000_000 },
      envelope: null,
      allowCurlHeader: false,
    });
    expect(resolved).toEqual({
      value: "1700000000",
      source: "payload",
    });
  });
});

describe("readPayloadTimestamp", () => {
  it("reads numeric unix seconds and ISO datetime", () => {
    expect(readPayloadTimestamp({ timestamp: 1_700_000_000 })).toBe(
      "1700000000"
    );
    expect(readPayloadTimestamp({ datetime: "2023-11-14T22:13:20.000Z" })).toBe(
      String(Date.parse("2023-11-14T22:13:20.000Z"))
    );
  });

  it("returns null for missing or invalid values", () => {
    expect(readPayloadTimestamp(null)).toBeNull();
    expect(readPayloadTimestamp({})).toBeNull();
    expect(readPayloadTimestamp({ timestamp: -1 })).toBeNull();
    expect(readPayloadTimestamp({ datetime: "not-a-date" })).toBeNull();
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

  it("honors a longer default window for payload timestamps (Alert Rule lag)", () => {
    // 1 hour ago: stale under the 300s header default, fresh under 7200s
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 3600), undefined, now).ok
    ).toBe(false);
    expect(
      checkSharedSecretFreshness(String(nowSeconds - 3600), undefined, now, {
        defaultWindowSeconds: 7200,
      }).ok
    ).toBe(true);
  });
});
