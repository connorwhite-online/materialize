/**
 * Few-shot exemplars — well-designed parametric build123d parts the harness
 * shows the model as style references. Exemplars teach *taste* (fillet
 * discipline, parametric structure, edge treatment) more effectively than any
 * rule list.
 *
 * All code here is authored in-house (fully license-clean — no third-party
 * source). Apache-2.0 build123d/bd_warehouse examples may be added later with
 * a NOTICE; marketplace meshes are NOT usable (NC/SA + wrong representation).
 *
 * VERIFICATION CONTRACT: an exemplar is only injected into a real prompt when
 * `verified: true`. These ship `verified: false` until each has been run
 * through the CAD sidecar and confirmed to compile + produce a valid
 * watertight solid (see scripts/verify-exemplars.ts). This guarantees we never
 * teach the model from code we haven't proven correct.
 */

export interface CadExemplar {
  id: string;
  title: string;
  /** Prompt keywords this exemplar is a good match for. */
  keywords: string[];
  /** The aesthetic/structural lesson it demonstrates (kept with the few-shot). */
  lesson: string;
  /** Idiomatic build123d source. Must assign the solid to `result`. */
  code: string;
  /** Flipped to true only after the sidecar confirms it compiles + is valid. */
  verified: boolean;
}

export const CAD_EXEMPLARS: CadExemplar[] = [
  {
    id: "rounded_enclosure",
    title: "Rounded shelled enclosure",
    keywords: ["enclosure", "box", "case", "housing", "container", "lid", "project box"],
    lesson:
      "One reused corner radius on all vertical edges, a small consistent top-edge break, a base chamfer for stance, and a shelled interior — parametric throughout.",
    code: [
      "from build123d import *",
      "",
      "length, width, height = 80, 60, 28",
      "wall = 2.0",
      "corner_radius = 6.0   # one radius family, reused",
      "edge_break = 1.0      # consistent small break on the top rim",
      "base_chamfer = 1.0    # stance + avoids elephant-foot",
      "",
      "with BuildPart() as part:",
      "    Box(length, width, height)",
      "    fillet(part.edges().filter_by(Axis.Z), corner_radius)",
      "    fillet(part.edges().group_by(Axis.Z)[-1], edge_break)",
      "    chamfer(part.edges().group_by(Axis.Z)[0], base_chamfer)",
      "    top = part.faces().sort_by(Axis.Z)[-1]",
      "    offset(amount=-wall, openings=top)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "fillet_hierarchy_bracket",
    title: "L-bracket with fillet hierarchy",
    keywords: ["bracket", "mount", "angle", "gusset", "support", "l-bracket"],
    lesson:
      "Fillet hierarchy: a large radius at the structural root (load path + looks), small breaks on cosmetic edges; bolt holes sized to a standard clearance.",
    code: [
      "from build123d import *",
      "",
      "arm = 40        # length of each arm",
      "width = 30",
      "thick = 5",
      "root_fillet = 3.0   # large radius where arms meet (< thickness)",
      "edge_break = 1.0",
      "hole_d = 5.5        # M5 clearance",
      "",
      "with BuildPart() as part:",
      "    Box(arm, width, thick, align=(Align.MIN, Align.CENTER, Align.MIN))",
      "    Box(thick, width, arm, align=(Align.MIN, Align.CENTER, Align.MIN))",
      "    fillet(part.edges().filter_by(Axis.Y).group_by(Axis.X)[0].sort_by(Axis.Z)[1], root_fillet)",
      "    # bolt holes through each arm",
      "    with Locations((arm - 10, 0, 0)):",
      "        Hole(hole_d / 2, depth=thick)",
      "    fillet(part.edges().filter_by(GeomType.LINE).group_by(SortBy.LENGTH)[0], edge_break)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "snap_fit_lid",
    title: "Snap-fit lid",
    keywords: ["lid", "cap", "cover", "snap", "snap-fit", "clip", "closure"],
    lesson:
      "Functional feature design: a lip with lead-in chamfer and defined clearance to the body, rounded outer edges, parametric fit gap.",
    code: [
      "from build123d import *",
      "",
      "outer = 60          # lid outer size",
      "height = 8",
      "wall = 2.0",
      "lip_h = 4.0",
      "fit_gap = 0.2       # clearance to the box inner wall (printed snug fit)",
      "edge_round = 2.0",
      "",
      "with BuildPart() as part:",
      "    Box(outer, outer, height)",
      "    fillet(part.edges().filter_by(Axis.Z), edge_round)",
      "    fillet(part.edges().group_by(Axis.Z)[-1], 1.0)",
      "    # inner lip that drops into the box",
      "    inner = outer - 2 * wall - 2 * fit_gap",
      "    with BuildSketch(part.faces().sort_by(Axis.Z)[0]):",
      "        Rectangle(inner, inner)",
      "        Rectangle(inner - 2 * wall, inner - 2 * wall, mode=Mode.SUBTRACT)",
      "    extrude(amount=lip_h)",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 0.8)  # lead-in",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "ergonomic_knob",
    title: "Ergonomic knurled knob",
    keywords: ["knob", "dial", "grip", "handle", "control", "twist"],
    lesson:
      "Organic form via revolve-like stacking + polar finger scallops; tactile chamfers; a height:diameter proportion that reads as designed.",
    code: [
      "from build123d import *",
      "",
      "dia = 35           # power-grip-friendly diameter",
      "height = 18",
      "scallop_r = 3.0",
      "n_scallops = 12",
      "shaft_d = 6.2      # press-fit onto a 6 mm shaft",
      "",
      "with BuildPart() as part:",
      "    Cylinder(dia / 2, height)",
      "    chamfer(part.edges().group_by(Axis.Z)[-1], 2.0)  # crowned top edge",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 1.0)   # base",
      "    # finger scallops around the rim",
      "    with PolarLocations(dia / 2, n_scallops):",
      "        Cylinder(scallop_r, height, mode=Mode.SUBTRACT)",
      "    # shaft bore from the bottom",
      "    with Locations(part.faces().sort_by(Axis.Z)[0]):",
      "        Hole(shaft_d / 2, depth=height - 3)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "divider_tray",
    title: "Compartment tray",
    keywords: ["tray", "organizer", "divider", "compartment", "holder", "caddy", "bin"],
    lesson:
      "Repeated-feature rhythm via a grid, consistent internal corner radii, even rim, draftable walls — coherence across an array of pockets.",
    code: [
      "from build123d import *",
      "",
      "length, width, height = 120, 80, 30",
      "wall = 2.0",
      "cols, rows = 3, 2",
      "inner_r = 3.0      # one internal corner radius, reused",
      "",
      "with BuildPart() as part:",
      "    Box(length, width, height)",
      "    fillet(part.edges().filter_by(Axis.Z), 5.0)",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 1.0)",
      "    pocket_l = (length - wall * (cols + 1)) / cols",
      "    pocket_w = (width - wall * (rows + 1)) / rows",
      "    with BuildSketch(part.faces().sort_by(Axis.Z)[-1]):",
      "        with GridLocations(pocket_l + wall, pocket_w + wall, cols, rows):",
      "            RectangleRounded(pocket_l, pocket_w, inner_r)",
      "    extrude(amount=-(height - wall), mode=Mode.SUBTRACT)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "lofted_vase",
    title: "Lofted vase",
    keywords: ["vase", "vessel", "pot", "planter", "cup", "organic", "lofted"],
    lesson:
      "Smooth swept form via loft between offset profiles, thin-wall shell, tangent transitions — pushes beyond box-and-fillet output.",
    code: [
      "from build123d import *",
      "",
      "base_d = 50",
      "waist_d = 38",
      "rim_d = 56",
      "height = 120",
      "wall = 2.4",
      "",
      "with BuildPart() as part:",
      "    with BuildSketch(Plane.XY):",
      "        Circle(base_d / 2)",
      "    with BuildSketch(Plane.XY.offset(height * 0.45)):",
      "        Circle(waist_d / 2)",
      "    with BuildSketch(Plane.XY.offset(height)):",
      "        Circle(rim_d / 2)",
      "    loft()",
      "    top = part.faces().sort_by(Axis.Z)[-1]",
      "    offset(amount=-wall, openings=top)",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 1.0)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
];

/** Score an exemplar against a prompt by keyword hits. */
function score(prompt: string, ex: CadExemplar): number {
  const p = prompt.toLowerCase();
  return ex.keywords.reduce((s, k) => (p.includes(k) ? s + 1 : s), 0);
}

/**
 * Pick the best-matching VERIFIED exemplar(s) for a prompt. Unverified
 * exemplars are never returned, so an unproven part can't reach the model.
 * `pool` is injectable for tests.
 */
export function selectExemplars(
  prompt: string,
  opts: { limit?: number; pool?: CadExemplar[] } = {}
): CadExemplar[] {
  const limit = opts.limit ?? 1;
  const pool = (opts.pool ?? CAD_EXEMPLARS).filter((e) => e.verified);
  return pool
    .map((e) => ({ e, s: score(prompt, e) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ e }) => e);
}

export function formatExemplars(rows: CadExemplar[]): string {
  if (rows.length === 0) return "";
  const blocks = rows.map(
    (e) =>
      `Example — ${e.title} (${e.lesson}):\n\`\`\`python\n${e.code}\n\`\`\``
  );
  return [
    "Reference example(s) of well-designed parametric build123d (match this level of edge treatment and parametric structure; do not copy verbatim):",
    ...blocks,
  ].join("\n\n");
}
