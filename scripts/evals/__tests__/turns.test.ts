import { describe, expect, it } from "vitest";

import { gradeTurn } from "../turns";
import type { CadRunResult } from "../../../lib/cad/types";

/**
 * Unit coverage for the deterministic revision-turn oracle (MTR-183). No model
 * or sidecar needed — we feed synthetic before/after source + geometry and
 * assert the grader catches a delta that did not land and a regression that
 * did, which is exactly what a live case would fail on.
 */

function run(dims: { x: number; y: number; z: number }): CadRunResult {
  return {
    ok: true,
    files: {},
    validation: {
      compiled: true,
      isSolid: true,
      isWatertight: true,
      isManifold: true,
    },
    geometry: { dimensions: dims },
  };
}

const invalidRun: CadRunResult = {
  ok: false,
  files: {},
  validation: {
    compiled: true,
    isSolid: true,
    isWatertight: false,
    isManifold: true,
  },
  geometry: { dimensions: { x: 60, y: 40, z: 30 } },
};

describe("gradeTurn — paramChanged (the requested delta landed)", () => {
  const prevCode = "wall = 2.0\nlength = 60\n";
  it("passes when the named param reached the target and envelope held", () => {
    const g = gradeTurn({
      prevCode,
      nextCode: "wall = 2.4\nlength = 60\n",
      prevRun: run({ x: 60, y: 40, z: 30 }),
      nextRun: run({ x: 60, y: 40, z: 30 }),
      assert: { paramChanged: { name: "wall", to: 2.4 }, holdDims: { axes: ["x", "y", "z"] } },
    });
    expect(g.pass).toBe(true);
  });

  it("fails when the delta did NOT land (param unchanged) — the regression guard", () => {
    const g = gradeTurn({
      prevCode,
      nextCode: "wall = 2.0\nlength = 60\n", // model ignored the instruction
      prevRun: run({ x: 60, y: 40, z: 30 }),
      nextRun: run({ x: 60, y: 40, z: 30 }),
      assert: { paramChanged: { name: "wall", to: 2.4 } },
    });
    expect(g.pass).toBe(false);
    expect(g.failures.join(" ")).toMatch(/wall.*wanted 2\.4/);
  });

  it("fails when a held axis regressed even though the param landed", () => {
    const g = gradeTurn({
      prevCode,
      nextCode: "wall = 2.4\nlength = 60\n",
      prevRun: run({ x: 60, y: 40, z: 30 }),
      nextRun: run({ x: 72, y: 40, z: 30 }), // envelope moved
      assert: { paramChanged: { name: "wall", to: 2.4 }, holdDims: { axes: ["x", "y", "z"] } },
    });
    expect(g.pass).toBe(false);
    expect(g.failures.join(" ")).toMatch(/axis x regressed/);
  });
});

describe("gradeTurn — paramAdded (feature add)", () => {
  it("passes when a new named parameter appears", () => {
    const g = gradeTurn({
      prevCode: "height = 60\ndia = 20\n",
      nextCode: "height = 60\ndia = 20\nbore = 6\n",
      prevRun: run({ x: 20, y: 20, z: 60 }),
      nextRun: run({ x: 20, y: 20, z: 60 }),
      assert: { paramAdded: "bore", holdDims: { axes: ["x", "y", "z"] } },
    });
    expect(g.pass).toBe(true);
  });

  it("fails when the feature param did not appear", () => {
    const g = gradeTurn({
      prevCode: "height = 60\ndia = 20\n",
      nextCode: "height = 60\ndia = 20\n",
      prevRun: run({ x: 20, y: 20, z: 60 }),
      nextRun: run({ x: 20, y: 20, z: 60 }),
      assert: { paramAdded: "bore" },
    });
    expect(g.pass).toBe(false);
    expect(g.failures.join(" ")).toMatch(/bore/);
  });
});

describe("gradeTurn — validity and expectDims", () => {
  it("fails an invalid post-revision solid regardless of the delta", () => {
    const g = gradeTurn({
      prevCode: "a = 1\n",
      nextCode: "a = 2\n",
      prevRun: run({ x: 60, y: 40, z: 30 }),
      nextRun: invalidRun,
      assert: { paramChanged: { name: "a", to: 2 } },
    });
    expect(g.pass).toBe(false);
    expect(g.failures.join(" ")).toMatch(/invalid after revision/);
  });

  it("checks an overall bbox target after the turn", () => {
    const g = gradeTurn({
      prevCode: "s = 25\n",
      nextCode: "s = 30\n",
      prevRun: run({ x: 25, y: 25, z: 25 }),
      nextRun: run({ x: 30, y: 30, z: 30 }),
      assert: { expectDims: { x: 30, y: 30, z: 30 } },
    });
    expect(g.pass).toBe(true);
  });

  it("fails when the feedback-driven resize did not reach the target", () => {
    const g = gradeTurn({
      prevCode: "s = 25\n",
      nextCode: "s = 25\n",
      prevRun: run({ x: 25, y: 25, z: 25 }),
      nextRun: run({ x: 25, y: 25, z: 25 }),
      assert: { expectDims: { x: 30, y: 30, z: 30 } },
    });
    expect(g.pass).toBe(false);
    expect(g.failures.join(" ")).toMatch(/dimensions off target/);
  });
});
