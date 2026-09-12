/**
 * How lively the materializing cloud's wobble is — its amplitude and its rate.
 *
 * Two halves of one effect, so they live together. The abstract blob is
 * supposed to churn: it has no shape to protect, and the motion is what says
 * "working". Real geometry is the opposite — every bit of deformation is the
 * part being misreported, so once the cloud is showing a shape the wobble
 * drops to a slow shimmer that says "alive" without competing with the form.
 *
 * Amplitude was already clamped when the cloud formed; the RATE was not, so a
 * formed shape boiled at exactly the blob's speed for the whole generation.
 * Both are clamped now, and the formed rate is anchored to the blob's resting
 * rate: a shape at its busiest churns no faster than a blob at rest.
 *
 * These are the tuning knobs. Retuning is a one-line diff here, and nothing
 * else reads them.
 */

/** Noise-phase rate (multiplies delta into uTime) for the abstract blob. */
export const BLOB_ACTIVE_SPEED = 1.7;
export const BLOB_IDLE_SPEED = 0.6;

/** Noise-phase rate once the cloud is showing real geometry. */
export const FORMED_ACTIVE_SPEED = BLOB_IDLE_SPEED;
export const FORMED_IDLE_SPEED = 0.25;

/** Deformation amplitude ceiling once the cloud is showing real geometry:
 *  enough to stay alive, small enough that the shape still reads. */
export const FORMED_IDLE_AMP = 0.05;
export const FORMED_ACTIVE_AMP = 0.13;

export interface DeformTarget {
  /** Deformation amplitude (uAmp). */
  amp: number;
  /** Rate the noise phase advances (scales delta into uTime). */
  speed: number;
}

export interface DeformInputs {
  /** The cloud is showing real geometry — a surface base cloud, or it has
   *  morphed onto an in-progress solid — rather than the abstract blob. */
  formed: boolean;
  /** A build is running: generating, revising or planning. */
  active: boolean;
  /** This cloud's own resting amplitude. */
  idleAmp: number;
  /** This cloud's own working amplitude. */
  activeAmp: number;
}

/** What the wobble should settle to this frame. The caller lerps toward it, so
 *  a state change eases rather than snapping. */
export function deformTarget({
  formed,
  active,
  idleAmp,
  activeAmp,
}: DeformInputs): DeformTarget {
  if (!formed) {
    return {
      amp: active ? activeAmp : idleAmp,
      speed: active ? BLOB_ACTIVE_SPEED : BLOB_IDLE_SPEED,
    };
  }
  // `min`, not a replacement: a cloud whose own amps are already gentler than
  // the ceiling (a surface cloud) keeps its own.
  return active
    ? {
        amp: Math.min(activeAmp, FORMED_ACTIVE_AMP),
        speed: FORMED_ACTIVE_SPEED,
      }
    : { amp: Math.min(idleAmp, FORMED_IDLE_AMP), speed: FORMED_IDLE_SPEED };
}
