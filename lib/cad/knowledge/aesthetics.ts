/**
 * Aesthetic design directives for the text-to-CAD harness — injected on
 * EVERY generation (unlike process DFM blocks, edge-treatment/proportion
 * apply universally). The goal is output that reads as *designed*, not like
 * a raw CAD primitive.
 *
 * These are paraphrased industry principles + facts (radii ratios, "break
 * every edge", concentric-corner rule, etc.), distilled in our own words —
 * no source prose is reproduced. Sources mined (proprietary unless noted,
 * facts/principles are uncopyrightable): Fictiv/Protolabs/Core77/Xometry on
 * fillets & chamfers; SolidWorks/Fusion community on concentric walls;
 * Vitsœ/Design Museum on Rams' principles; NCBI PMC (open) + Fast Company on
 * the golden-ratio myth.
 *
 * Surfacing note: OCCT/build123d `fillet()` is constant-radius (G1/tangent),
 * not curvature-continuous (G2). G2 isn't cleanly reachable, so the practical
 * premium-surface lever is *large, consistent G1 fillets* on visible faces.
 */
export const AESTHETICS_RULES = `Make it look designed, not like a raw CAD primitive. Apply these unless the prompt explicitly overrides them:

EDGES (highest priority — untreated sharp edges are the #1 amateur tell):
- Break EVERY exposed external edge with a fillet or chamfer. No raw 90° external edges. Minimum ~0.4 mm; use a larger deliberate radius on primary visible faces.
- Fillet cosmetic/handled faces and structural transitions; chamfer functional edges, hole mouths, mating edges, and the build-plate base edge.
- Pick ONE dominant edge language (rounded OR chamfered) for the body and commit to it; use the other only as a sparing, consistent accent.

RADII (be disciplined, not arbitrary):
- Use at most ~3 distinct fillet radii in the whole part, snapped to a small family (e.g. 1 / 2 / 3 / 6 mm), and reuse them.
- Scale radius to form size: largest radius the geometry allows on the primary form, proportionally smaller on secondary details.
- Interior structural fillets ≈ 0.5–1.0 × wall thickness. At a walled corner keep the wall uniform: outer radius = inner radius + wall thickness.

PROPORTION & LAYOUT:
- Quantize key dimensions to a base module (0.5 or 1 mm) and minimize the count of distinct dimensions.
- Snap every feature (holes, bosses, ports, text) to shared datums/centerlines — no arbitrary offsets.
- Don't leave two principal bounding dimensions arbitrarily near-equal; make them equal, or clearly distinct (≥ ~1.3:1). Treat 1:√2, 1:1.5, 1:1.618 only as seeds to avoid arbitrariness — never as a quality target.
- Default to bilateral symmetry about the primary axis unless an asymmetry is functional. Keep the center of mass low and over the footprint.

STANCE & RESTRAINT:
- Give the part a deliberate base: a small recessed reveal (inset the bottom ~1–2 mm) or a distinct plinth, plus a ~45° base chamfer ≤ 1 mm tall (also avoids elephant-foot). Never end in a raw flush flat bottom with a sharp perimeter.
- Emit nothing non-functional: no decorative grooves, fake fasteners, or ornamental panel lines unless the prompt asks. Less, but better.`;
