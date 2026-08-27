/**
 * Colored-pencil treatment for the authed-home dropzone primitives.
 *
 * Lighting rolls through a soft same-family gradient (shadow → mid →
 * highlight) with paper tooth — evident shading, no hard cel bands.
 * The ink silhouette is a world-space outline hull.
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
 * A pen stroke that frames the colored-pencil fill.
 */
export const TOON_OUTLINE_THICKNESS = 0.042;

/**
 * How much the soft specular tip leans into the family highlight.
 * Colored pencil, not a hard anime coin.
 */
export const TOON_PENCIL_SPEC = 0.42;

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
