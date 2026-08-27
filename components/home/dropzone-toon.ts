/**
 * Graphic toon treatment for the authed-home dropzone primitives.
 *
 * Pencil-scribble / hatch at this scale (a ~12rem well) reads as
 * noise, not a sketch. Flat fills + a world-space ink stroke is the
 * cel look that still reads as a shape from across the dashboard.
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
 * ~3% of a unit primitive — a pen stroke, not a hull.
 */
export const TOON_OUTLINE_THICKNESS = 0.028;
