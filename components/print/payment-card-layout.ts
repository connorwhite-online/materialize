/**
 * Shared layout for the Materialize payment card — ISO ID-1
 * proportion and the logo/chip anchors. Kept free of three.js so
 * tests can pin "mark on the left, chip on the right" without
 * pulling WebGL into the unit suite.
 *
 * Units are card-heights: the body is CARD_W × CARD_H × CARD_T.
 * Negative X is left, positive Y is the top of the face.
 *
 * The body is intentionally a thin plate (not a chunky slab). The
 * first WebGL pass exaggerated thickness + corner radius and read
 * as a bubbly rounded brick next to the flat CSS face.
 */

/** 85.60 / 53.98 mm — ISO/IEC 7810 ID-1. */
export const CARD_W = 1.586;
export const CARD_H = 1;
/**
 * Real ID-1 is ~0.76 mm ≈ 0.014 card-heights. Keep it near that so
 * the mesh reads as a plane with a hint of edge, not a block.
 */
export const CARD_T = 0.014;
/** ~3.18 mm corner / 53.98 mm height ≈ 0.059 — stay under that. */
export const CARD_RADIUS = 0.045;

/**
 * How far the mark / chip / face copy sit above the card face.
 * Zero (coplanar with CARD_T/2) z-fights the body under IBL.
 */
export const FACE_LIFT = 0.003;

/** Top-left of the face. */
export const LOGO_POSITION: [number, number, number] = [
  -0.52,
  0.30,
  CARD_T / 2 + FACE_LIFT,
];

/**
 * Vertically centered on the right edge. x > 0 is right; y = 0 is
 * the face midline. Z is face + half the chip plate thickness.
 */
export const CHIP_POSITION: [number, number, number] = [
  0.54,
  0,
  CARD_T / 2 + FACE_LIFT + 0.003,
];

/** Target width of the flat mark, in card-height units. */
export const LOGO_WIDTH = 0.42;
