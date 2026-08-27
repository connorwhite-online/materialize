/**
 * Graphic toon treatment for the authed-home dropzone primitives.
 *
 * Lighting is quantized into three paint chips (shadow / mid / light)
 * plus a hard specular coin — comic cel, not a wrapped Lambert blend.
 * The ink outline is a world-space hull.
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
 * A comic pen stroke, a touch heavier than a hairline.
 */
export const TOON_OUTLINE_THICKNESS = 0.036;

/** Wrap-lighting edges for the mid and lit cel bands. */
export const TOON_MID_EDGE = 0.42;
export const TOON_LIT_EDGE = 0.76;
