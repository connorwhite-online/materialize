/**
 * Graphic toon treatment for the authed-home dropzone primitives.
 *
 * Flat unlit fills read as stickers with no form. A grayscale cel ramp
 * just muddy-darkens them. The dropzone shader mixes the catalog mid
 * toward a hue-shifted shadow and highlight over a wrapped Lambert
 * term — quiet color blends (purplish blue, pinkish red, yellowish
 * green), still graphic, plus the ink outline.
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
