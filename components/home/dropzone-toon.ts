/**
 * Graphic toon treatment for the authed-home dropzone primitives.
 *
 * Pencil-scribble / hatch at this scale (a ~12rem well) reads as
 * noise, not a sketch. Flat fills + a world-space ink stroke is the
 * cel look that still reads as a shape from across the dashboard.
 */

/** Warm ink, same hue family as the UI foreground — not pure black. */
export const TOON_INK = "#2c261c";

/**
 * World-space outline thickness. drei's `<Outlines>` treats
 * `thickness` as a world-space scale unless `screenspace` is set —
 * a CSS-like `2` inflates into a dark hull that eats the dropzone.
 */
export const TOON_OUTLINE_THICKNESS = 0.036;
