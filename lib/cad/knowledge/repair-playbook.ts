/**
 * Kernel-failure repair playbook, generation-side (MTR-198). Compiled from CAD
 * Skills' `repair-loop.md` + `build123d-modeling.md` (MIT, distilled from real
 * usage) — the OCCT failure modes an LLM reliably hits, phrased as PREVENTIVE
 * rules the model follows while it writes, so failures localize and repairs
 * stay cheap.
 *
 * Budget discipline (knowledge/index.ts): kept to the rules NOT already stated
 * in prompt.ts's SYSTEM_PROMPT — operation ORDERING, boolean OVERSHOOT, and
 * retry GRANULARITY are new; the fillet-radius pitfall already lives in
 * SYSTEM_PROMPT's "Common build123d pitfalls" and is not repeated here. The
 * symbolic-selector rule (MTR-226) IS restated below, deliberately: a repair
 * turn is exactly the moment an upstream edit has just invalidated a global
 * selector, so the reminder earns its keep here. The reactive stderr→fix
 * enrichment is separate (repair-taxonomy.ts).
 */
export const REPAIR_PLAYBOOK_RULES = `Build order (fragile steps LAST so failures localize and each is easy to fix):
- Base solid -> major additions -> subtractive features (pockets/holes) -> shell/hollow -> through-wall holes -> fillets and chamfers LAST. Fillets are the most failure-prone operation and every boolean invalidates edge selectors, so postpone them until the solid is otherwise final.
- OVERSHOOT boolean tools: extend a cutting tool past the faces it enters AND exits — for a through-cut, run it ~1 mm beyond both faces. Coincident or coplanar tool/target faces are a classic kernel failure; never leave a cut flush with a wall.
- SYMBOLIC SELECTORS ON REPAIR: when a fix changes upstream geometry, re-select the refinement's edges/faces from the NAMED intermediate that created them, not a global query re-run over the whole part — the global query silently resolves to a DIFFERENT edge set after your edit. Good: \`fillet(boss.edges().filter_by(GeomType.CIRCLE), r)\`. Bad: \`fillet(result.edges().filter_by(GeomType.CIRCLE), r)\`.
- Sanity-check proportions in millimeters against the requested numbers BEFORE finishing — order-of-magnitude and collision mistakes pass watertightness/validation yet are still wrong.
- If a step fails, change only the SMALLEST responsible section and rerun that step — do not regenerate the whole script.`;
