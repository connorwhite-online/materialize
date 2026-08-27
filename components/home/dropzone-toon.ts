/**
 * Flat sketch treatment for the authed-home dropzone primitives.
 *
 * Fill is almost flat pastel with a soft pencil shade on the dark
 * side — no cel bands, no specular coin. Form comes from the ink
 * silhouette (world-space outline hull) rather than lighting tricks.
 *
 * drei's `<Outlines screenspace>` flag is named backwards relative
 * to CSS: `true` extrudes along normals in world units (the inverted
 * hull). `false` divides by the drawing-buffer size, which is 0/1 on
 * the first frame and inflates a "2px" stroke into a dark blob.
 */

/** Warm ink — sketchbook pencil, not pure black. */
export const TOON_INK = "#2a241c";

/**
 * World-space outline extrusion (`screenspace` on `<Outlines>`).
 * A chunky pen stroke so the silhouette reads like a doodle.
 */
export const TOON_OUTLINE_THICKNESS = 0.045;

/**
 * How hard the soft pencil shade leans into the dark side.
 * 0 = pure flat fill; 1 = full shadow tint. Kept quiet on purpose.
 */
export const TOON_PENCIL_STRENGTH = 0.22;

/** Canvas CSS width (px) below which shapes shrink to fit the well. */
export const DROPZONE_MOBILE_MAX_WIDTH = 520;

/** Multiplier applied to each primitive's `scale` on narrow canvases. */
export const DROPZONE_MOBILE_SCALE = 0.68;

/** Corner radius on the unit rounded square — chubby, still a square. */
export const DROPZONE_SQUARE_RADIUS = 0.36;

/**
 * Pull frustum positions slightly inward on mobile so chubby shapes
 * sit inside the dashed well instead of clipping past the frame.
 */
export const DROPZONE_MOBILE_POSITION = 0.86;
