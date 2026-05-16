import { describe, it, expect } from "vitest";
import {
  decideEnvironmentDispatch,
  readEnvironment,
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
