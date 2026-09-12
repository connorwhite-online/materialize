/**
 * Spin of the materializing point cloud — the BLOB's alone.
 *
 * An abstract blob has no orientation of its own, so a slow tumble is what makes
 * it read as alive. Real geometry does: the moment the cloud forms a shape, any
 * spin is the shape being turned away from how the model is actually framed, so
 * it stops — and the morph unwinds whatever spin had accumulated.
 *
 * The unwind is driven by the SAME eased morph progress as the shape, not by its
 * own tween, so rotation reaches exactly 0 on the frame the shape lands. That
 * exactness is load-bearing: the final handoff freezes the cloud at its target
 * for pixel-registration with the crisp <ModelViewer fixedFrame> behind it, and
 * a residual tilt there is a visible jump at the crossfade. Two tweens of the
 * same length still trace different paths (the same trap documented for the
 * mobile nav's card) — one progress value driving both cannot drift.
 */

/** Spin rate (rad/s) about y while a build is running. */
export const SPIN_RATE_ACTIVE = 0.1;
/** Spin rate (rad/s) about y at rest. */
export const SPIN_RATE_IDLE = 0.06;
/** x turns at a fraction of y — a tumble, not a barrel roll. */
export const SPIN_X_RATIO = 0.3;

export interface Spin {
  x: number;
  y: number;
}

export interface SpinFrame {
  /** Current rotation. */
  current: Spin;
  /** Frame delta, seconds. */
  delta: number;
  /** A build is running (faster tumble). */
  active: boolean;
  /** The cloud is bound to real geometry — the base cloud IS a model's surface,
   *  or a morph onto one has started. Spin never accumulates while true. */
  shaping: boolean;
  /** Rotation captured when shaping began, unwound to 0 across the morph.
   *  Null once it has been paid off (or when there was nothing to unwind). */
  unwindFrom: Spin | null;
  /** Eased morph progress, 0→1, same value the shape morph is drawn at. 1 when
   *  no morph is in flight, so a finished cloud holds at 0. */
  easedMorph: number;
}

/** The cloud's rotation for this frame. */
export function nextSpin({
  current,
  delta,
  active,
  shaping,
  unwindFrom,
  easedMorph,
}: SpinFrame): Spin {
  if (!shaping) {
    const rate = active ? SPIN_RATE_ACTIVE : SPIN_RATE_IDLE;
    return {
      x: current.x + delta * rate * SPIN_X_RATIO,
      y: current.y + delta * rate,
    };
  }
  if (!unwindFrom) return { x: current.x, y: current.y };
  const remaining = 1 - Math.min(1, Math.max(0, easedMorph));
  return { x: unwindFrom.x * remaining, y: unwindFrom.y * remaining };
}
