import { describe, expect, it } from "vitest";
import {
  SPIN_RATE_ACTIVE,
  SPIN_RATE_IDLE,
  SPIN_X_RATIO,
  type Spin,
  nextSpin,
  shortestSpin,
  shortestTurn,
} from "../cloud-spin";

const ZERO: Spin = { x: 0, y: 0 };

/** Run `frames` fixed-delta frames through nextSpin. */
function run(
  frames: number,
  opts: {
    delta?: number;
    active?: boolean;
    shaping?: boolean;
    unwindFrom?: Spin | null;
    easedMorph?: number;
    from?: Spin;
  } = {}
): Spin {
  const {
    delta = 1 / 60,
    active = false,
    shaping = false,
    unwindFrom = null,
    easedMorph = 1,
    from = ZERO,
  } = opts;
  let current = from;
  for (let i = 0; i < frames; i++) {
    current = nextSpin({
      current,
      delta,
      active,
      shaping,
      unwindFrom,
      easedMorph,
    });
  }
  return current;
}

describe("nextSpin", () => {
  it("tumbles the blob — y at the spin rate, x at a fraction of it", () => {
    const spin = nextSpin({
      current: ZERO,
      delta: 1,
      active: false,
      shaping: false,
      unwindFrom: null,
      easedMorph: 1,
    });
    expect(spin.y).toBeCloseTo(SPIN_RATE_IDLE, 10);
    expect(spin.x).toBeCloseTo(SPIN_RATE_IDLE * SPIN_X_RATIO, 10);
    expect(spin.x).toBeLessThan(spin.y);
  });

  it("tumbles faster while a build is running", () => {
    const idle = run(60);
    const active = run(60, { active: true });
    expect(active.y).toBeGreaterThan(idle.y);
    expect(active.y / idle.y).toBeCloseTo(SPIN_RATE_ACTIVE / SPIN_RATE_IDLE, 6);
  });

  it("never accumulates rotation once the cloud is geometry", () => {
    const held: Spin = { x: 0.3, y: 1.2 };
    // No morph in flight (easedMorph 1) and nothing to unwind: the shape holds
    // exactly where it is, for any number of frames, active or not.
    expect(run(600, { shaping: true, from: held })).toEqual(held);
    expect(run(600, { shaping: true, active: true, from: held })).toEqual(held);
  });

  it("a surface cloud opens in the model's framing and stays there", () => {
    // `shaped` bases latch shaping before the first frame, so they never spin
    // off the framing they loaded in.
    expect(run(600, { shaping: true })).toEqual(ZERO);
  });

  it("unwinds the standing spin across the morph, reaching exactly 0", () => {
    const standing: Spin = { x: 0.4, y: 2.5 };
    const at = (easedMorph: number) =>
      nextSpin({
        current: standing,
        delta: 1 / 60,
        active: true,
        shaping: true,
        unwindFrom: standing,
        easedMorph,
      });

    expect(at(0)).toEqual(standing);
    expect(at(0.5).x).toBeCloseTo(standing.x / 2, 10);
    expect(at(0.5).y).toBeCloseTo(standing.y / 2, 10);
    // Exactly 0, not asymptotically near it: the final handoff freezes the
    // cloud here for pixel-registration with the crisp model, so a residual
    // tilt would be a visible jump at the crossfade.
    expect(at(1)).toEqual(ZERO);
  });

  it("unwinds monotonically — the spin only ever loses ground", () => {
    const standing: Spin = { x: -0.7, y: 3.1 };
    let prev = Math.abs(standing.y);
    for (let i = 1; i <= 20; i++) {
      const { y } = nextSpin({
        current: standing,
        delta: 1 / 60,
        active: false,
        shaping: true,
        unwindFrom: standing,
        easedMorph: i / 20,
      });
      expect(Math.abs(y)).toBeLessThan(prev);
      prev = Math.abs(y);
    }
    expect(prev).toBe(0);
  });

  it("clamps eased progress so it can neither overshoot nor rewind past the origin", () => {
    const standing: Spin = { x: 0.2, y: 1 };
    const frame = (easedMorph: number) =>
      nextSpin({
        current: standing,
        delta: 1 / 60,
        active: false,
        shaping: true,
        unwindFrom: standing,
        easedMorph,
      });
    expect(frame(1.4)).toEqual(ZERO);
    expect(frame(-0.3)).toEqual(standing);
  });
});

describe("shortestTurn", () => {
  it("leaves a turn already inside half a rotation alone", () => {
    for (const a of [0, 0.5, -0.5, 3, -3]) {
      expect(shortestTurn(a)).toBeCloseTo(a, 10);
    }
  });

  it("expresses whole banked turns as the same orientation, the short way", () => {
    const TAU = Math.PI * 2;
    for (const turns of [1, 2, 5, -1, -3]) {
      // Same orientation (differs by a whole number of turns) ...
      const wrapped = shortestTurn(0.4 + TAU * turns);
      expect((0.4 + TAU * turns - wrapped) / TAU).toBeCloseTo(turns, 8);
      // ... but never more than half a turn from home.
      expect(Math.abs(wrapped)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it("bounds the unwind at half a turn however long the blob tumbled", () => {
    // The defect this exists to prevent: three minutes of tumble is 18 rad,
    // and unwinding THAT across a ~1s morph spins the forming shape through
    // every whole turn it had banked.
    const spun = SPIN_RATE_ACTIVE * 180;
    expect(spun).toBeGreaterThan(Math.PI * 2);
    expect(Math.abs(shortestTurn(spun))).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(shortestSpin({ x: spun, y: spun }).y)).toBeLessThanOrEqual(
      Math.PI
    );
  });
});

describe("nextSpin, over a long session", () => {
  it("keeps the blob's angle canonical instead of growing without bound", () => {
    // Ten minutes of tumble at 60fps.
    const spin = run(60 * 600, { active: true });
    expect(Math.abs(spin.y)).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(spin.x)).toBeLessThanOrEqual(Math.PI);
  });

  it("never unwinds more than half a turn per axis", () => {
    // However long it tumbled, the capture is wrapped, so the whole unwind —
    // measured as the distance travelled from origin to 0 — stays bounded.
    const tumbled = run(60 * 600, { active: true });
    const captured = shortestSpin(tumbled);
    const peakPerSecond =
      (Math.abs(captured.y) * 1.5) / 0.9; // eased peak over the live morph
    expect(Math.abs(captured.y)).toBeLessThanOrEqual(Math.PI);
    // The pre-fix code unwound the raw angle: ~10 rad/s at this length.
    expect(peakPerSecond).toBeLessThan(6);
  });
});
