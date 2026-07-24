/**
 * Dual-fluid exchanger recipe — injected when the prompt asks for a
 * two-fluid TPMS part (heat exchanger, dual-fluid manifold, hot/cold core)
 * so the model reaches for the verified `exchanger_core` pipeline instead of
 * hand-rolling seals it will get wrong. Complements the ORGANIC-FUNCTIONAL
 * section of the system prompt (which teaches the sdf_kit vocabulary): this
 * block states the *decision procedure*, the manifold-capping physics, and
 * the verification contract.
 */

export const EXCHANGER_RECIPE_RULES = `DUAL-FLUID EXCHANGER RECIPE — a two-fluid TPMS part (heat exchanger, dual-fluid manifold) gets this pipeline by default:
1. WHY IT WORKS: a TPMS sheet (\`|distance-to-midsurface| <= wall/2\` solid) splits space into TWO congruent, fully separate labyrinths that share every wall — maximum exchange area per volume. Isolation is mathematically guaranteed as long as the solid contains the midsurface; the enemy is the BOUNDARY, where a plain cut exposes BOTH labyrinths on every face.
2. DEFAULT PATH — the composed generator (preferred; its seals and verification probes are pre-solved):
   \`from exchanger import exchanger_core\`
   \`field, ports, plugs, bounds = exchanger_core(size, cell, wall, kind="gyroid", flow="cross"|"counter")\`
   Asymmetric ports take a dict: \`port_r={"a_in": 6.0, "a_out": 5.0, "b": 3.0}\` (names or fluid prefixes; missing keys auto-size). Orientation is chosen by axis order in \`size\` — fluid A's plenums sit on the ±X faces, B's on ±Y (cross), so put the axis that runs BETWEEN each fluid's port faces first/second accordingly. ALWAYS also pass \`a_face=(w, h)\` and \`b_face=(w, h)\` with the port-face dimensions straight from the spec ("hot ports on the 150x60 faces" -> \`a_face=(150, 60)\`): the generator refuses a wrong \`size\` ordering and names the correct one — orientation mistakes have shipped twice without this. \`blend\` (default on) smooth-fillets the hood-to-body junction so the loft reads as one form.
   Hose connections: \`hose={"a_in": 63.0, "a_out": 50.0, "b": 12.7}\` (inner diameters, mm) builds the external manifolds FOR you as hood lofts — each hooded port opens its ENTIRE plenum window through the skin (the header collects the whole core face, not a small bore) and morphs rect-to-round down to the hose bore with a cubic-eased (Bezier-swept, tangent both ends) profile, then a ringed barb run; plugs and meshing bounds update automatically. This is the fluid-dynamically correct header — do not replace it with a bore + cone. NEVER hand-roll external manifolds when exchanger_core builds the core: a hand-rolled manifold once reused the +X face position with a sign flip for the -X port and bored a 50mm leak path straight through the core. If you must hand-roll, each side's face position is lo[axis] / hi[axis] — never ±sign on one face value — and every manifold must GROW the mesh bbox on its own side.
   \`result = to_mesh(field, *bounds, pitch)\` with \`pitch <= wall/3\`, then \`fluid_ports = ports\` and \`fluid_plugs = plugs\` — those two assignments trigger the sidecar's isolation check automatically.
3. FLOW ARRANGEMENT: "cross" = fluid A along X, B along Y (matches "hot across cold"); "counter" = both along X with split plenums per face (thermodynamically superior when the brief cares). The labyrinths interpenetrate everywhere — arrangement is purely port placement.
4. PARAMETERS THAT PRINT: cell 6-12mm (de-powdering/drainage sets the floor, not the printer); wall >= 1.0mm polymer, >= 0.5mm metal — the thinnest point of a TPMS sheet runs ~12% under nominal, and \`to_mesh\` pitch must stay <= wall/3 or marching cubes punches pinholes through the wall. Gyroid is the default kind (self-supporting, moderate pressure drop); diamond gives ~25% more area at higher pressure drop.
5. HAND-ROLLED CORES (only when the composed generator cannot express the shape): build ONE \`dual_sheet(P, cell, wall, seal_a=..., seal_b=...)\` field — NEVER two overlapping lattices, and NEVER approximate the sheet as \`|g| * scale - wall/2\` on the raw gyroid value: the linear g-to-mm estimate collapses away from the midsurface, and a "2mm sheet" built that way captures ~80% of the volume — the part meshes as a near-solid brick with pinprick voids. \`tpms_dist\`/\`dual_sheet\` are the ONLY approved distance conversions. Near every face that serves fluid A, seal fluid B with \`seal_ramp(<mm-into-core from that face>, cell/2)\` and vice versa; a face with no plenum gets sealed by solid skin instead. Every port face needs the OTHER fluid sealed — miss one and the check will (correctly) fail the build.
6. VERIFY OR IT DIDN'T HAPPEN: always declare \`fluid_ports\` — a LIST of \`{"name": "a_in", "point": [x, y, z], "r": mm}\` probes (names a_in/a_out/b_in/b_out, each point sitting in open fluid space), NOT a dict of name -> point — plus \`fluid_plugs\` (a LIST of \`{"a": [x,y,z], "b": [x,y,z], "r": mm}\` capsules spanning each port bore, so the check can virtually cap them — open ports otherwise read as a leak through outside air), AND \`fluid_min_feature = wall\` — it forces the isolation probe fine enough to resolve your walls; without it a large part gets probed coarser than the wall and sound geometry reads as a phantom leak. A malformed declaration is a check ERROR, not a skip. The check proves isolation at voxel resolution: report it as "no leak wider than ~pitch", never "leak-free".
7. PORTS BIGGER THAN THE FACE, AND DIMENSION HONESTY: a circular bore only fits a face when its diameter clears the face's SHORT side minus skin — a 63mm bore does not fit a 60mm-tall face, ever. The correct pattern is the lofted external manifold: the plenum chamber inside the core collects the WHOLE face, and a dome/neck OUTSIDE the core tapers to the requested hose diameter with a straight barb run. Mesh the FULL body — core plus stubs — in the sample box; NEVER shrink the to_mesh bounds to clip protruding stubs so the bounding box reads the core dims (that ships amputated barbs to hit a number). When the user gives CORE dimensions and ports protrude, the overall bbox is legitimately larger: state core vs overall in the brief instead of gaming the measurement.
8. HONEST LIMITS: dead-end stubs of each fluid near the other's sealed faces trap powder/resin — say so when asked about manufacturing; do NOT add drain holes (each one is a leak).`;

/**
 * Two-fluid prompt detector. Requires either an explicit exchanger noun, or
 * a dual-fluid phrasing near TPMS/lattice vocabulary — a plain "gyroid lamp
 * shade" must NOT get the exchanger pipeline.
 */
const EXCHANGER_NOUNS =
  /\bheat.?exchangers?\b|\bintercoolers?\b|\brecuperators?\b|\bregenerators?\b/i;
const DUAL_FLUID_HINTS =
  /\b(dual|two|twin|second(ary)?)[- ]?(fluid|liquid|coolant|circuit|channel|loop|network)s?\b|\bhot\b.{0,40}\bcold\b|\bcoolant\b.{0,30}\b(loop|circuit|channel)s?\b/i;
const TPMS_HINTS =
  /\b(gyroid|tpms|schwarz|minimal surface|lattice|labyrinths?)\b/i;

export function needsExchangerRecipe(prompt: string): boolean {
  if (EXCHANGER_NOUNS.test(prompt)) return true;
  return DUAL_FLUID_HINTS.test(prompt) && TPMS_HINTS.test(prompt);
}
