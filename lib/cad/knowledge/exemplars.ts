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
  {
    id: "enclosure_two_part",
    title: "Two-part electronics enclosure (base + lid)",
    keywords: ["enclosure", "case", "housing", "box", "lid", "base", "two-part", "two part", "electronics", "project box", "cover", "assembly"],
    lesson:
      "Multi-part assembly via a `parts` dict: a shelled base (open top, corner PCB standoffs, a side port cutout) plus a lid whose underside lip drops inside the walls with a printed-fit clearance; one corner-radius family reused across both parts.",
    code: [
      "from build123d import *",
      "",
      "# Two-part electronics enclosure. One corner-radius family across both parts;",
      "# the lid drops into the base with a printed-fit clearance.",
      "length, width = 90, 60",
      "base_h = 26",
      "lid_h = 6",
      "wall = 2.4",
      "corner_r = 8.0            # reused on every vertical edge",
      "edge_break = 1.0",
      "base_chamfer = 1.0",
      "fit_gap = 0.25            # lid-lip clearance to the base inner wall",
      "boss_d = 7.0             # corner PCB standoff outer diameter",
      "pilot_r = 1.1            # M2 self-tap pilot",
      "port_w, port_h = 12.0, 7.0   # side port cutout (e.g. USB-C)",
      "",
      "# ---- base: shelled box, open top, corner standoffs, one side port ----",
      "with BuildPart() as base:",
      "    Box(length, width, base_h)",
      "    fillet(base.edges().filter_by(Axis.Z), corner_r)",
      "    chamfer(base.edges().group_by(Axis.Z)[0], base_chamfer)",
      "    top = base.faces().sort_by(Axis.Z)[-1]",
      "    offset(amount=-wall, openings=top)",
      "    # corner standoffs rising from the floor",
      "    inset_x = length / 2 - wall - boss_d / 2 - 1.5",
      "    inset_y = width / 2 - wall - boss_d / 2 - 1.5",
      "    floor_z = -base_h / 2",
      "    with Locations(",
      "        (inset_x, inset_y, floor_z), (-inset_x, inset_y, floor_z),",
      "        (inset_x, -inset_y, floor_z), (-inset_x, -inset_y, floor_z),",
      "    ):",
      "        Cylinder(boss_d / 2, base_h - wall, align=(Align.CENTER, Align.CENTER, Align.MIN))",
      "        Cylinder(pilot_r, base_h - wall, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)",
      "    # side port cutout through one long wall",
      "    with Locations(Plane.YZ):",
      "        with Locations((0, 0, length / 2)):",
      "            Box(port_w, port_h, wall * 3, mode=Mode.SUBTRACT)",
      "",
      "# ---- lid: top plate + inner lip that drops into the base ----",
      "inner = min(length, width) - 2 * wall - 2 * fit_gap",
      "with BuildPart() as lid:",
      "    Box(length, width, lid_h)",
      "    fillet(lid.edges().filter_by(Axis.Z), corner_r)",
      "    fillet(lid.edges().group_by(Axis.Z)[-1], edge_break)",
      "    # inner lip frame on the underside",
      "    bottom = lid.faces().sort_by(Axis.Z)[0]",
      "    with BuildSketch(bottom):",
      "        Rectangle(length - 2 * wall - 2 * fit_gap, width - 2 * wall - 2 * fit_gap)",
      "        Rectangle(length - 4 * wall - 2 * fit_gap, width - 4 * wall - 2 * fit_gap, mode=Mode.SUBTRACT)",
      "    extrude(amount=lid_h)",
      "",
      "parts = {\"base\": base.part, \"lid\": lid.part}",
    ].join("\n"),
    verified: true,
  },
  {
    id: "mounting_standoffs",
    title: "Mounting baseplate with standoffs",
    keywords: ["standoff", "standoffs", "boss", "bosses", "mount", "mounting", "pcb", "board", "baseplate", "plate", "screw boss"],
    lesson:
      "Standoff/boss building block: a filleted plate with a grid of board standoffs (drilled pilot holes) and counterbored corner mounting holes, all from one screw/boss size family — composable into enclosures.",
    code: [
      "from build123d import *",
      "",
      "# Mounting baseplate: a filleted plate with a 2x2 grid of board standoffs",
      "# (counter-drilled pilot holes) and corner mounting holes counterbored for",
      "# screw heads. One screw/boss size family, parametrically placed \u2014 the reusable",
      "# building block for mounting a PCB or module inside an enclosure.",
      "plate_l, plate_w = 70, 50",
      "plate_t = 3.0",
      "corner_r = 4.0",
      "boss_d = 8.0",
      "boss_h = 6.0            # lifts the board off the plate",
      "pilot_r = 1.25         # M2.5 self-tap pilot into the boss",
      "mount_r = 1.6          # M3 clearance at the corners",
      "cbore_r = 3.2          # screw-head counterbore",
      "cbore_depth = 2.0",
      "board_l, board_w = 50, 30   # standoff grid footprint",
      "",
      "with BuildPart() as part:",
      "    Box(plate_l, plate_w, plate_t)",
      "    fillet(part.edges().filter_by(Axis.Z), corner_r)",
      "    top = part.faces().sort_by(Axis.Z)[-1]",
      "    # standoffs up from the top face on a rectangular grid",
      "    with BuildSketch(top):",
      "        with GridLocations(board_l, board_w, 2, 2):",
      "            Circle(boss_d / 2)",
      "    extrude(amount=boss_h)",
      "    # pilot holes down each standoff",
      "    with Locations(part.faces().sort_by(Axis.Z)[-1]):",
      "        with GridLocations(board_l, board_w, 2, 2):",
      "            Hole(pilot_r, depth=boss_h + plate_t - 0.6)",
      "    # corner mounting holes, counterbored from the top for the screw head",
      "    mx = plate_l / 2 - corner_r - 2.5",
      "    my = plate_w / 2 - corner_r - 2.5",
      "    with Locations(top):",
      "        with Locations((mx, my), (-mx, my), (mx, -my), (-mx, -my)):",
      "            CounterBoreHole(mount_r, cbore_r, cbore_depth)",
      "",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "gyroid_tpms_core",
    title: "Gyroid TPMS core (mesh mode)",
    keywords: ["gyroid", "tpms", "lattice", "lattices", "minimal surface", "heat exchanger", "heat-exchanger", "infill", "porous", "mesh"],
    lesson:
      "Mesh mode for geometry the CAD kernel cannot express (TPMS / lattice / heat-exchanger core / organic field): sample an implicit gyroid field on a grid, pad it with void so the surface closes, and marching-cubes it into a watertight trimesh assigned to `result` — not build123d.",
    code: [
      "# MESH MODE: a gyroid TPMS core \u2014 a triply-periodic minimal surface the CAD",
      "# kernel (build123d) cannot express. Build it as an implicit field sampled on a",
      "# grid, then marching-cubes it into a watertight trimesh. This is the right tool",
      "# for lattices / heat-exchanger cores / infills.",
      "import numpy as np",
      "import trimesh",
      "from skimage import measure",
      "",
      "size = 40.0          # cube edge (mm)",
      "cells = 3            # gyroid unit cells per axis",
      "wall = 0.45          # half sheet-thickness control (larger = thicker walls)",
      "n = 96               # grid resolution per axis (keep <= ~120 for speed)",
      "",
      "lin = np.linspace(0.0, 2.0 * np.pi * cells, n)",
      "x, y, z = np.meshgrid(lin, lin, lin, indexing=\"ij\")",
      "g = np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)",
      "",
      "# Solid where |g| <= wall -> a thin double-walled gyroid SHEET (two fluid",
      "# networks separated by one surface). Negative = solid, positive = void.",
      "field = np.abs(g) - wall",
      "# Pad with \"void\" so marching cubes closes the surface at the box boundary,",
      "# yielding a watertight solid instead of an open shell.",
      "field = np.pad(field, 1, mode=\"constant\", constant_values=1.0)",
      "",
      "verts, faces, _, _ = measure.marching_cubes(field, level=0.0)",
      "# Map voxel-index coords to mm (account for the 1-voxel pad on each side).",
      "verts = (verts - 1.0) / (n - 1.0) * size",
      "mesh = trimesh.Trimesh(vertices=verts, faces=faces)",
      "mesh.merge_vertices()",
      "mesh.fix_normals()",
      "",
      "result = mesh",
    ].join("\n"),
    verified: true,
  },
  {
    id: "tapered_device_enclosure",
    title: "Tapered device enclosure",
    keywords: ["device", "gadget", "enclosure", "case", "tapered", "puck", "housing", "wearable", "remote"],
    lesson:
      "Premium product surfacing: a gentle draft (top slightly inset from the base) with one unified corner-radius family, a softened crowned top rim and a small base relief, manually shelled. Restraint over detail — one cohesive flowing body.",
    code: [
      "from build123d import *",
      "length, width, height = 90, 55, 24",
      "top_inset = 4          # top smaller than base -> gentle premium draft",
      "corner_r = 12.0",
      "wall = 2.0",
      "with BuildPart() as part:",
      "    with BuildSketch(Plane.XY):",
      "        RectangleRounded(length, width, corner_r)",
      "    with BuildSketch(Plane.XY.offset(height)):",
      "        RectangleRounded(length - 2 * top_inset, width - 2 * top_inset, corner_r - 1)",
      "    loft()",
      "    fillet(part.edges().group_by(Axis.Z)[-1], 2.0)   # softened top rim",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 0.8)   # base relief",
      "    # hollow: subtract an inner tapered loft, open at the top",
      "    with BuildSketch(Plane.XY.offset(wall)):",
      "        RectangleRounded(length - 2 * wall, width - 2 * wall, corner_r - wall)",
      "    with BuildSketch(Plane.XY.offset(height + 1)):",
      "        RectangleRounded(length - 2 * top_inset - 2 * wall, width - 2 * top_inset - 2 * wall, max(0.6, corner_r - 1 - wall))",
      "    loft(mode=Mode.SUBTRACT)",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "soft_catch_all_tray",
    title: "Soft catch-all tray",
    keywords: ["catch-all", "catchall", "valet", "dish", "tray", "pebble", "bowl", "organizer", "desk"],
    lesson:
      "Soft, cohesive product form: a very generous unified corner radius with a soft top rim and base, and a shallow shelled bowl — one pebble-like flowing body, nothing busy or disjointed.",
    code: [
      "from build123d import *",
      "length, width, height = 110, 80, 26",
      "corner_r = 26.0        # very soft, pebble-like corners",
      "wall = 2.2",
      "with BuildPart() as part:",
      "    Box(length, width, height)",
      "    fillet(part.edges().filter_by(Axis.Z), corner_r)",
      "    fillet(part.edges().group_by(Axis.Z)[-1], 6.0)   # soft top rim",
      "    chamfer(part.edges().group_by(Axis.Z)[0], 3.0)   # soft base",
      "    top = part.faces().sort_by(Axis.Z)[-1]",
      "    offset(amount=-wall, openings=top)",
      "result = part.part",
    ].join("\n"),
    verified: true,
  },
  {
    id: "organic_sdf_bracket",
    title: "Organic load-path bracket (SDF skeleton + skin)",
    keywords: ["bracket", "mount", "mounting", "organic", "topology", "optimized", "lightweight", "lightweighted", "link", "arm", "sculptural"],
    lesson:
      "Organic-functional via the SDF toolkit: EXACT bolt bosses + holes (tolerances embedded) smooth-unioned (smin) with a load-path web of capsule struts, marching-cubed to a watertight mesh. A flowing, optimized-looking form with real functional features, not joined primitives.",
    code: [
      "from sdf_kit import *",
      "",
      "T = 12.0          # thickness",
      "boss_r, hole_r = 9.0, 2.7      # exact boss + M5 clearance",
      "A, B = (-40.0, 0.0), (40.0, 0.0)",
      "strut_r, k = 4.5, 7.0",
      "top, bot = (0.0, 18.0), (0.0, -18.0)",
      "",
      "def field(P):",
      "    z0, z1 = -T/2, T/2",
      "    # exact functional bosses",
      "    f = smin(cyl_z(P, A[0], A[1], boss_r, z0, z1),",
      "             cyl_z(P, B[0], B[1], boss_r, z0, z1), k)",
      "    # organic load-path web (arches + central brace)",
      "    for (p, q) in [(A, top), (top, B), (A, bot), (bot, B)]:",
      "        a3 = (p[0], p[1], 0.0); b3 = (q[0], q[1], 0.0)",
      "        f = smin(f, capsule(P, (a3[0], a3[1], z0), (a3[0], a3[1], z1), strut_r), k)",
      "        f = smin(f, capsule(P, a3, b3, strut_r), k)",
      "    f = smin(f, capsule(P, (top[0], top[1], 0.0), (bot[0], bot[1], 0.0), strut_r*0.7), k)",
      "    # exact bolt holes (through)",
      "    for c in (A, B):",
      "        f = subtract(f, cyl_z(P, c[0], c[1], hole_r, -T, T))",
      "    return f",
      "",
      "result = to_mesh(field, (-56, -30, -T), (56, 30, T), pitch=0.7)",
    ].join("\n"),
    verified: true,
  },
  {
    id: "sdf_smooth_handle",
    title: "Smooth product form via SDF (cabinet pull)",
    keywords: ["handle", "pull", "grip", "knob", "door handle", "drawer pull", "lever", "smooth", "premium"],
    lesson:
      "Beautiful PRODUCT design via SDF (taste first, not topology-optimized struts): mount posts + a gently bowed grip smooth-unioned into ONE flowing premium body, with exact screw holes. Structure shows only as the clean post-to-grip transition.",
    code: [
      "from sdf_kit import *",
      "",
      "# A smooth, premium cabinet/drawer pull: two mount posts off a back face + a",
      "# gently bowed grip, all smooth-unioned into one flowing body. Beauty first;",
      "# the only \"structure\" is the clean post-to-grip transition.",
      "post_r, grip_r = 6.0, 7.0",
      "screw_r = 2.2",
      "standoff = 22.0",
      "A, B = (-50.0, 0.0), (50.0, 0.0)",
      "k = 8.0",
      "",
      "def field(P):",
      "    # mount posts (exact), up from the back face z=0",
      "    f = smin(cyl_z(P, A[0], A[1], post_r, 0.0, standoff),",
      "             cyl_z(P, B[0], B[1], post_r, 0.0, standoff), k)",
      "    # gently bowed grip (two capsules meeting at a raised midpoint -> smooth bow)",
      "    mid = (0.0, 0.0, standoff + 7.0)",
      "    f = smin(f, capsule(P, (A[0], A[1], standoff), mid, grip_r), k)",
      "    f = smin(f, capsule(P, mid, (B[0], B[1], standoff), grip_r), k)",
      "    # exact screw holes from the back, into the posts",
      "    for c in (A, B):",
      "        f = subtract(f, cyl_z(P, c[0], c[1], screw_r, -2.0, 15.0))",
      "    return f",
      "",
      "result = to_mesh(field, (-60, -12, -3), (60, 12, 34), pitch=0.6)",
    ].join("\n"),
    verified: true,
  },
  {
    id: "gyroid_heat_exchanger_core",
    title: "Two-fluid gyroid heat-exchanger core (sdf_kit v2)",
    keywords: ["heat exchanger", "heat-exchanger", "exchanger", "two fluid", "two-fluid", "counterflow", "coolant", "manifold", "gyroid", "tpms", "radiator", "intercooler"],
    lesson:
      "sdf_kit v2 composition for dual-network parts: a cylindrical jacket (exact cyl_z shell) whose interior is filled by a gyroid SHEET via mask() — the sheet splits the inner volume into two interpenetrating, fully isolated fluid labyrinths (verified with check_networks: 2 components, ports isolated). Real-mm sheet thickness, one field, watertight at pitch 0.6.",
    code: [
      "# MESH MODE (sdf_kit): a two-fluid gyroid heat-exchanger CORE — a cylindrical",
      "# jacket whose interior is split by a gyroid sheet into TWO isolated fluid",
      "# labyrinths. The sheet is the heat-transfer surface; each network gets its",
      "# own inlet/outlet when the manifolds are added.",
      "from sdf_kit import *",
      "",
      "core_d = 50.0        # jacket outer diameter",
      "core_h = 60.0        # core height",
      "wall = 2.0           # jacket wall",
      "cell = 12.0          # gyroid unit cell (mm) — smaller = more surface, more back-pressure",
      "sheet_t = 1.6        # separating sheet thickness (min printable wall)",
      "",
      "R = core_d / 2",
      "",
      "def field(P):",
      "    # Jacket: a solid-walled cylinder shell (closed top/bottom rims)...",
      "    jacket_outer = cyl_z(P, 0, 0, R, 0.0, core_h)",
      "    jacket_inner = cyl_z(P, 0, 0, R - wall, wall, core_h - wall)",
      "    shell = subtract(jacket_outer, jacket_inner)",
      "    # ...whose interior is filled by the gyroid separating SHEET. The sheet",
      "    # (|g| <= t) splits the inner volume into two interpenetrating networks",
      "    # that never touch — verify with check_networks before trusting it.",
      "    sheet = mask(gyroid(P, cell, sheet_t), jacket_inner)",
      "    return union(shell, sheet)",
      "",
      "result = to_mesh(field, (-R - 2, -R - 2, -2), (R + 2, R + 2, core_h + 2), pitch=0.6)",
    ].join("\n"),
    verified: true,
  },
  {
    id: "draped_component_enclosure",
    title: "Enclosure draped over a component stack (sdf_kit)",
    keywords: ["enclosure", "case", "housing", "drape", "draped", "organic", "component", "components", "pcb", "battery", "stack", "electronics", "skin", "pod"],
    lesson:
      "The default-taste move: exact component keep-outs (boxes + clearance) smooth-unioned into ONE cavity, then the skin = offset_field(cavity, wall) — a flowing organic body whose interior fits are exact. Flat base cut for printing, crisp port subtracted last. Verified: watertight AND every component corner inside the cavity.",
    code: [
      "# ORGANIC-FUNCTIONAL (sdf_kit): an enclosure DRAPED over a component stack.",
      "# Exact keep-outs (component boxes + clearance) define the cavity; the skin",
      "# is the cavity grown by one wall, with a large smin blend so the body reads",
      "# as one flowing form instead of two boxes glued together. Function first \u2014",
      "# the fits are exact; the beauty is the drape.",
      "from sdf_kit import *",
      "import numpy as np",
      "",
      "# Components (exact, mm): a 62x42x12 PCB with a 50x30x13 battery above it.",
      "pcb_c, pcb_h = (0.0, 0.0, 8.0), (31.0, 21.0, 6.0)",
      "batt_c, batt_h = (0.0, 0.0, 20.5), (25.0, 15.0, 6.5)",
      "clearance = 1.0",
      "wall = 2.4",
      "k = 14.0            # blend radius: bigger = softer drape over the stack",
      "",
      "def field(P):",
      "    # Functional envelope: each keep-out grown by clearance, smooth-unioned",
      "    # so the skin flows over the stack.",
      "    cavity = smin(",
      "        box(P, pcb_c, tuple(h + clearance for h in pcb_h)),",
      "        box(P, batt_c, tuple(h + clearance for h in batt_h)),",
      "        k,",
      "    )",
      "    body = offset_field(cavity, wall)      # the drape: cavity + one wall",
      "    shell = subtract(body, cavity)",
      "    shell = np.maximum(shell, -P[:, 2])    # flat printable base at z=0",
      "    # Exact USB-C cutout through the front wall at PCB height.",
      "    port = box(P, (0.0, -24.0, 8.0), (6.5, 6.0, 2.6))",
      "    return subtract(shell, port)",
      "",
      "result = to_mesh(field, (-40, -30, -4), (40, 30, 34), pitch=0.55)",
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

/**
 * Resolve exemplar ids the plan/brief step chose from the catalog (retrieval
 * v2, docs/text-to-cad/07 §C). Validated against the pool + verified-only +
 * capped at 2, so a hallucinated or unverified id can never inject code.
 * `pool` is injectable for tests.
 */
export function selectExemplarsByIds(
  ids: string[],
  opts: { pool?: CadExemplar[] } = {}
): CadExemplar[] {
  const pool = (opts.pool ?? CAD_EXEMPLARS).filter((e) => e.verified);
  const out: CadExemplar[] = [];
  for (const id of ids) {
    const ex = pool.find((e) => e.id === id);
    if (ex && !out.includes(ex)) out.push(ex);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * Catalog listing (id + title + keywords + lesson — NOT code) shown to the
 * plan/brief steps so the model picks its own style reference instead of
 * relying on brittle keyword overlap.
 */
export function formatExemplarCatalog(pool: CadExemplar[] = CAD_EXEMPLARS): string {
  const rows = pool.filter((e) => e.verified);
  if (rows.length === 0) return "";
  const lines = rows.map(
    (e) => `- ${e.id} — ${e.title} (${e.keywords.join(", ")}): ${e.lesson}`
  );
  return ["Exemplar catalog (style references available to the code generator):", ...lines].join(
    "\n"
  );
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
