import { describe, expect, it } from "vitest";
import { CYCLE_S, PLAIN, nextSweep, sweepEase } from "../burn-sweep";
import { LANDING_MATERIALS } from "../landing-materials";

describe("burn sweep schedule", () => {
  it("cycles through every family on the first step, one per CYCLE_S", () => {
    let look = PLAIN;
    const seen = [look];
    for (let i = 0; i < LANDING_MATERIALS.length; i++) {
      expect(nextSweep(0, look, CYCLE_S - 0.01, false)).toBeNull();
      const next = nextSweep(0, look, CYCLE_S, false);
      expect(next).not.toBeNull();
      look = next!;
      seen.push(look);
    }
    // Visits all five and wraps back to the plain plastic.
    expect(new Set(seen).size).toBe(LANDING_MATERIALS.length);
    expect(look).toBe(PLAIN);
  });

  it("sweeps back to the plain plastic once when leaving the first step", () => {
    expect(nextSweep(1, 3, 0, false)).toBe(PLAIN);
    expect(nextSweep(2, 4, 0, false)).toBe(PLAIN);
    // …and then holds, however long it sits there.
    expect(nextSweep(1, PLAIN, 999, false)).toBeNull();
    expect(nextSweep(2, PLAIN, 999, false)).toBeNull();
  });

  it("never interrupts a sweep in flight", () => {
    expect(nextSweep(0, 2, 999, true)).toBeNull();
    expect(nextSweep(1, 2, 999, true)).toBeNull();
  });

  it("climbs from bottom to top and lands exactly", () => {
    expect(sweepEase(0)).toBe(0);
    expect(sweepEase(1)).toBe(1);
    for (let t = 0.1; t < 1; t += 0.1) {
      expect(sweepEase(t)).toBeGreaterThan(sweepEase(t - 0.1));
    }
  });
});
