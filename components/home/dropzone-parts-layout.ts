import type { IsometricPartKind } from "./isometric-parts";

/**
 * Placement + ink for the isometric parts behind the authed-home
 * dropzone. Kept apart from the renderer so it can be tuned (and
 * tested) without loading three.js.
 */

export interface DropzonePart {
  kind: IsometricPartKind;
  /**
   * Rest position as a fraction of the canvas: x −1 left edge, +1
   * right; y −1 bottom, +1 top.
   */
  position: readonly [number, number];
  /**
   * Narrow-canvas override; the chip takes most of a phone's width.
   * `null` drops the part on narrow canvases entirely.
   */
  mobilePosition?: readonly [number, number] | null;
  /** Largest extent as a fraction of the canvas height (capped at 140px). */
  size: number;
  /** Extra yaw (radians) before the isometric pose, for variety. */
  yaw: number;
  floatPx: number;
  floatSpeed: number;
  phase: number;
}

/**
 * Line width in CSS pixels. Tones come from `BACKDROP_INK`
 * (`lib/isometric/palette.ts`).
 */
export const DROPZONE_PARTS_LINE_WIDTH = 1.25;

export const DROPZONE_PARTS_MOBILE_MAX_WIDTH = 520;
export const DROPZONE_PARTS_MOBILE_SCALE = 0.72;

export const DROPZONE_PARTS: readonly DropzonePart[] = [
  {
    kind: "thruster",
    position: [-0.4, 0.04],
    mobilePosition: [-0.66, 0.12],
    size: 0.7,
    yaw: 0.35,
    floatPx: 2,
    floatSpeed: 0.55,
    phase: 0.4,
  },
  {
    kind: "manifold",
    position: [0.6, 0.08],
    mobilePosition: [0.66, 0.18],
    size: 0.62,
    yaw: 0,
    floatPx: 2.5,
    floatSpeed: 0.62,
    phase: 1.2,
  },
  {
    kind: "impeller",
    // Between the chip and the manifold on desktop. A phone's well is
    // ~120px tall with the chip filling the middle, and there's no
    // slot left that doesn't crowd it, so the phone shows two parts.
    position: [0.29, -0.1],
    mobilePosition: null,
    size: 0.46,
    yaw: 0,
    floatPx: 1.5,
    floatSpeed: 0.5,
    phase: 2.1,
  },
];
