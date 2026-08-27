/**
 * Graphic toon treatment for the authed-home dropzone primitives.
 *
 * Lighting is quantized into four paint chips (deep / shadow / mid /
 * highlight) plus a hard specular coin and a rim stroke — comic cel,
 * not a wrapped Lambert blend. The ink outline is a world-space hull.
 *
 * drei's `<Outlines screenspace>` flag is named backwards relative
 * to CSS: `true` extrudes along normals in world units (the inverted
 * hull). `false` divides by the drawing-buffer size, which is 0/1 on
 * the first frame and inflates a "2px" stroke into a dark blob.
 */

/** Warm ink, same hue family as the UI foreground — not pure black. */
export const TOON_INK = "#2c261c";

/**
 * World-space outline extrusion (`screenspace` on `<Outlines>`).
 * A comic pen stroke — heavy enough to read as ink, not a hairline.
 */
export const TOON_OUTLINE_THICKNESS = 0.052;

/**
 * Wrap-lighting edges for the four cel bands.
 * Deep → shadow → mid → lit, in that order.
 */
export const TOON_DEEP_EDGE = 0.28;
export const TOON_MID_EDGE = 0.5;
export const TOON_LIT_EDGE = 0.78;

/** Fresnel threshold for the cartoon rim stroke (1 − N·V). */
export const TOON_RIM_EDGE = 0.58;
