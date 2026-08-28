/**
 * Shared layout for the Materialize payment card — ISO ID-1
 * proportion and the logo/chip anchors. Kept free of three.js so
 * tests can pin "mark on the left, chip on the right" without
 * pulling WebGL into the unit suite.
 *
 * Units are card-heights: the body is CARD_W × CARD_H × CARD_T.
 * Negative X is left, positive Y is the top of the face.
 */

/** 85.60 / 53.98 mm — ISO/IEC 7810 ID-1. */
export const CARD_W = 1.586;
export const CARD_H = 1;
/** Exaggerated vs a real 0.76 mm card so the volume reads at sheet size. */
export const CARD_T = 0.05;
export const CARD_RADIUS = 0.07;

/**
 * How far the mark / chip / face copy sit above the card face.
 * Zero (coplanar with CARD_T/2) z-fights the body under IBL and
 * reads as a glitchy shimmer on the logo during idle tilt.
 */
export const FACE_LIFT = 0.008;

/** Top-left of the face. */
export const LOGO_POSITION: [number, number, number] = [
  -0.52,
  0.30,
  CARD_T / 2 + FACE_LIFT,
];

/**
 * Vertically centered on the right edge. x > 0 is right; y = 0 is
 * the face midline (not the top corner — that read as a sticker).
 * Z is face + half the chip thickness so the plate sits on the
 * surface instead of sinking into it.
 */
export const CHIP_POSITION: [number, number, number] = [
  0.54,
  0,
  CARD_T / 2 + FACE_LIFT + 0.007,
];

/** Target width of the extruded mark, in card-height units. */
export const LOGO_WIDTH = 0.42;
