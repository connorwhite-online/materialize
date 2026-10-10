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

/** Background grid behind the parts: drafting dots or a line grid. */
export const DROPZONE_GRID: "dots" | "lines" = "dots";

export const DROPZONE_PARTS_MOBILE_MAX_WIDTH = 520;
export const DROPZONE_PARTS_MOBILE_SCALE = 0.72;

/**
 * Six parts scattered across the well, a few bleeding off its edges —
 * the well is a window onto a bench of parts, not a frame around three.
 * The chip owns the centre band; nothing sits behind it. Phones keep
 * four, pushed further out so the chip stays clear.
 */
export const DROPZONE_PARTS: readonly DropzonePart[] = [
  {
    kind: "engine",
    position: [-0.42, 0.04],
    mobilePosition: [-0.72, 0.28],
    size: 0.82,
    yaw: 0,
    floatPx: 2,
    floatSpeed: 0.55,
    phase: 0.4,
  },
  {
    kind: "gyroid",
    position: [0.58, 0.16],
    mobilePosition: [0.72, 0.34],
    size: 0.5,
    yaw: 0,
    floatPx: 2.5,
    floatSpeed: 0.62,
    phase: 1.2,
  },
  {
    kind: "hinge",
    position: [0.3, -0.14],
    mobilePosition: null,
    size: 0.46,
    yaw: 0,
    floatPx: 1.5,
    floatSpeed: 0.5,
    phase: 2.1,
  },
  {
    kind: "fan",
    // Cropped by the left edge.
    position: [-0.94, -0.3],
    mobilePosition: [-0.95, -0.55],
    size: 0.85,
    yaw: 0,
    floatPx: 1.5,
    floatSpeed: 0.45,
    phase: 0.9,
  },
  {
    kind: "spring",
    position: [-0.16, -0.62],
    mobilePosition: null,
    size: 0.42,
    yaw: 0.4,
    floatPx: 1.2,
    floatSpeed: 0.58,
    phase: 2.8,
  },
  {
    kind: "gear",
    // Cropped by the right and bottom edges.
    position: [0.9, -0.5],
    mobilePosition: [0.86, -0.6],
    size: 0.62,
    yaw: 0.2,
    floatPx: 2,
    floatSpeed: 0.5,
    phase: 1.7,
  },
];
