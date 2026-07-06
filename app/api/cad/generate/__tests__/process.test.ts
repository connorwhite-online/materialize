import { describe, it, expect } from "vitest";

// The route pulls in the background-job executor and the DB client at import
// time; neither is exercised by the pure helpers under test, so stub them to
// keep the module graph light and deterministic.
import { vi } from "vitest";
vi.mock("@/lib/cad/jobs", () => ({
  createCadJob: vi.fn(),
  executeCadJob: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { parseTargetProcess, resolveGenerationProcess } from "../route";

/**
 * MTR-171 — target-process threading. These cover the two decisions the route
 * makes before the harness ever runs: (1) only a real PROCESS_DFM key becomes a
 * process, everything else is treated as unset (conservative envelope); (2) a
 * revision inherits its parent's stamped process unless the request overrides.
 */
describe("parseTargetProcess", () => {
  it("accepts every real PROCESS_DFM key", () => {
    for (const p of ["fdm", "sla", "sls", "mjf", "dmls", "binder_jet"]) {
      expect(parseTargetProcess(p)).toBe(p);
    }
  });

  it("rejects 'any', unknown strings, and non-strings as null", () => {
    expect(parseTargetProcess("any")).toBeNull();
    expect(parseTargetProcess("")).toBeNull();
    expect(parseTargetProcess("cnc")).toBeNull();
    expect(parseTargetProcess(undefined)).toBeNull();
    expect(parseTargetProcess(null)).toBeNull();
    expect(parseTargetProcess(42)).toBeNull();
    // Prototype-chain keys must not slip through the `in` check semantics.
    expect(parseTargetProcess("toString")).toBeNull();
  });
});

describe("resolveGenerationProcess", () => {
  it("uses an explicit valid pick on a fresh build (no parent)", () => {
    expect(resolveGenerationProcess("sla", null)).toBe("sla");
  });

  it("stays unset on a fresh build with no pick", () => {
    expect(resolveGenerationProcess(undefined, null)).toBeNull();
    expect(resolveGenerationProcess("any", null)).toBeNull();
  });

  it("inherits the parent's process when the revision omits one", () => {
    expect(
      resolveGenerationProcess(undefined, { route: "simple", process: "fdm" })
    ).toBe("fdm");
  });

  it("lets an explicit pick override the inherited process", () => {
    expect(
      resolveGenerationProcess("dmls", { route: "simple", process: "fdm" })
    ).toBe("dmls");
  });

  it("treats 'any' on a revision as no override, so it still inherits", () => {
    expect(
      resolveGenerationProcess("any", { process: "sls" })
    ).toBe("sls");
  });

  it("stays unset when the parent carries no (or an invalid) process", () => {
    expect(resolveGenerationProcess(undefined, { route: "simple" })).toBeNull();
    expect(
      resolveGenerationProcess(undefined, { process: "bogus" })
    ).toBeNull();
    expect(resolveGenerationProcess(undefined, {})).toBeNull();
  });
});
