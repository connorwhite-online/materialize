/**
 * Default enclosure recipe (MTR-192) — injected when the prompt is
 * enclosure-shaped so a bare "make an enclosure for X" gets the
 * drape-and-split pipeline (or the disciplined two-part B-rep pattern) by
 * default instead of a naive single box. Complements the ORGANIC-FUNCTIONAL
 * section of the system prompt: that text teaches the sdf_kit vocabulary;
 * this block states the *decision procedure* and the closure patterns.
 */

export const ENCLOSURE_RECIPE_RULES = `DEFAULT ENCLOSURE RECIPE — a bare "enclose these components" request gets this pipeline by default (never a naive single box with a hole):
1. STACK: write every component's exact dims as named variables and grow each by a clearance (0.5-1 mm) into a keep-out.
2. CAVITY: combine the keep-outs into ONE cavity — smin() with a generous blend (k ~10-16) in sdf mode, or a single explicit inner-offset pocket in build123d.
3. SKIN: the body is the cavity plus ONE uniform thin wall (1.8-2.4 mm): offset_field(cavity, wall). Plan-forms are continuous curves (sq_prism superellipse: n~4.5 desk, n~1.7-2.2 handheld) — never an extruded rectangle with corner fillets.
4. SPLIT: enclosures are TWO-PIECE by default — split_shell(body, cavity, z_split, fit_gap~0.25) into printed-fit halves assigned to the parts dict, seam on a natural shadow line (a component transition). Cut ports/apertures AFTER the split so they notch the lip like a real product seam.
5. CLOSURE MENU (pick by service intent, make every fit a named + asserted parameter):
   - friction lip (split_shell's default): sealed-ish, tool-free — fit_gap ~0.25.
   - snap: lip ridges engaging window openings through the walls; COMPUTE the engagement depth (ridge tip past inner wall face >= 0.5 mm) and assert it.
   - screws: M3 heat-set boss = 4.0 mm bore; self-tap = pilot ~0.8x thread dia; clearance + counterbore on the outer part, boss on the inner.
   - hinge: alternating knuckles sharing ONE axis behind the wall, pin bore a slip fit (bore - pin >= 0.25 mm), axial knuckle gaps >= 0.3 mm, barrels tied in with webs.
6. BOARD DATUMS: for a named board/module (Pico, ESP32, SSD1306, ...) use its TRUE datums — mounting-hole grid, port positions, glass vs active area — and assert them (aperture smaller than the module, larger than its active area; USB reachable through the wall).
7. EDGE BUDGET: exterior soft, interior crisp — mating faces, bosses, and component pockets stay unfilleted; vents come as a rhythmic slot field, not one hole.
Mode choice: sdf drape when the form should flow over a stacked profile or the brief says organic/soft; plain build123d two-part (shelled base + lipped lid) when the design is crisp and prismatic. Either way the recipe above applies.`;

/**
 * Enclosure-shaped prompt detector. Matches the enclosure nouns, or a
 * box/case-like ask around electronics components. Word-boundaried so
 * "staircase"/"bookcase" don't trip it, and "box" alone (a plain container)
 * doesn't either — a bare box prompt shouldn't be steered into a two-piece
 * component enclosure.
 */
const ENCLOSURE_NOUNS = /\b(enclosures?|housings?|casings?)\b|\bproject box(es)?\b/i;
const CASE_NOUN = /\bcases?\b/i;
const COMPONENT_HINTS =
  /\b(pcb|board|electronics?|battery|batteries|components?|sensor|module|display|oled|lcd|arduino|esp32|esp8266|pico|raspberry|micro:?bit|devkit|dev board|devboard|mcu|microcontroller)\b/i;

export function needsEnclosureRecipe(prompt: string): boolean {
  if (ENCLOSURE_NOUNS.test(prompt)) return true;
  if (CASE_NOUN.test(prompt) && COMPONENT_HINTS.test(prompt)) return true;
  return /\bbox\b/i.test(prompt) && COMPONENT_HINTS.test(prompt);
}

/**
 * Targeted repair note for the enclosure-split enforcement (MTR-213): the
 * request is enclosure-shaped but the run produced a SINGLE part instead of the
 * two-piece assembly the recipe mandates. This steers the model to the `parts`
 * dict — the OPPOSITE of the generic "merge into one solid" fragment-gate hint,
 * which is exactly what collapsed the enclosure to one shallow shell. Kept as a
 * shared, deterministic string (like the recipe rules) so evals stay stable.
 * Deliberately avoids the kernel-failure trigger words (fuse / watertight /
 * boolean / export) so `enrichRepairHint` does not misclassify it as a kernel
 * crash and append contradictory "reduce the boolean count" fixes.
 */
export const ENCLOSURE_SPLIT_REPAIR_NOTE =
  "this is a TWO-PIECE enclosure but the script produced a SINGLE part. Assign the two shells to a `parts` dict — `parts = {\"base\": <base solid>, \"lid\": <lid solid>}`, each a separate closed solid — instead of one `result`. Do NOT merge the base and lid into one body, and do NOT stuff both shells into a single `result` compound (the fragment gate rejects that). Shell the base with an open top; give the lid an inner lip with a printed-fit clearance (~0.25 mm), seam on a natural shadow line. Make the internal cavity tall enough to actually enclose the component stack (respect each component's keep-out height), not a shallow tray.";
