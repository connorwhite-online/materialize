import type { ExpectedDims } from "../../lib/cad/prompt";
import type { DimensionTarget } from "../../lib/cad/dimension-check";

/**
 * Frozen text-to-CAD eval set. Tiered by difficulty so a scorecard shows
 * where the harness's competence boundary is (not just an average). Add
 * cases over time; treat passing cases as regression tests.
 *
 * `expectedDims` (mm) is the LEGACY bbox check — still honored, converted to
 * dimension targets by the runner. New cases use `expectations` (MTR-201):
 * structured, machine-checked expectations that reuse MTR-197's dimension
 * machinery (`lib/cad/dimension-check.ts`) plus LLM-judged negative checks —
 * NO parallel implementation.
 *
 * ── Benchmark seed set (attribution) ──────────────────────────────────────
 * The `bench-*` cases below adopt the rubric FORMAT of the CAD Skills project's
 * `benchmarks/*.md` (an exact prompt + a table of checkable expectations + a
 * negative-check row), which is MIT-licensed. CAD Skills never automated their
 * benchmarks (no runner/scoring — their issue #94 is a reproducibility
 * complaint); we port the format into our existing runner so the gate actually
 * bites. Prompts + numeric targets here are authored in-house against that
 * format, not copied. These cases are deliberately more mechanical than typical
 * marketplace prompts — they probe exactly where agents wobble.
 */
export type EvalTier =
  | "primitive"
  | "bracket"
  | "container"
  | "mechanical"
  | "assembly"
  | "implicit"
  | "implicit-composite"
  | "benchmark";

/**
 * Structured, machine-checkable expectations for a case (MTR-201).
 * - `dims`   — dimension targets checked via `checkDimensionTargets` (bbox
 *              spans + solid/part counts run deterministically; diameter /
 *              distance are declared but report not-run until MTR-196).
 * - `negativeChecks` — natural-language properties that must NOT be present,
 *              LLM-judged from the render packet where geometry can't express
 *              them (e.g. "no decorative geometry", "no chamfers on the holes").
 */
export interface EvalExpectations {
  dims?: DimensionTarget[];
  negativeChecks?: string[];
}

export interface EvalCase {
  id: string;
  tier: EvalTier;
  prompt: string;
  /** Legacy bbox check (converted to dimension targets by the runner). */
  expectedDims?: ExpectedDims;
  /** MTR-201 structured expectations. */
  expectations?: EvalExpectations;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "cube-20",
    tier: "primitive",
    prompt: "a 20mm cube",
    expectedDims: { x: 20, y: 20, z: 20 },
  },
  {
    id: "cylinder-30x10",
    tier: "primitive",
    prompt: "a cylinder 30mm tall and 10mm in diameter",
    expectedDims: { x: 10, y: 10, z: 30 },
  },
  {
    id: "l-bracket",
    tier: "bracket",
    prompt:
      "an L-shaped mounting bracket, 40mm x 40mm legs, 3mm thick, with a 5mm bolt hole in each leg",
  },
  {
    id: "box-with-lid",
    tier: "container",
    prompt:
      "a rectangular box 60x40x30mm with 2mm walls, open top, and a flat base",
    expectedDims: { x: 60, y: 40, z: 30 },
  },
  {
    id: "phone-stand",
    tier: "container",
    prompt: "a parametric phone stand for a 7mm-thick phone at a 65 degree angle",
  },
  {
    id: "hex-nut-m8",
    tier: "mechanical",
    prompt: "an M8 hex nut, 13mm across flats, 6.5mm thick, with a clearance bore",
  },
  // Frontier / capability-tracking cases — the hard end of the harness. These
  // exercise the multi-part contract and mesh mode (D); a regression here means
  // a capability was lost, not just a quality dip.
  {
    id: "enclosure-assembly",
    tier: "assembly",
    prompt:
      "a two-part electronics enclosure (separate base and lid), about 90x60x30mm, with 2.4mm walls, a USB-C port cutout in one side, and four internal PCB standoffs",
  },
  {
    id: "gyroid-core",
    tier: "implicit",
    prompt:
      "a 40mm cube gyroid TPMS lattice for a heat-exchanger core, ~3 unit cells per axis",
    expectedDims: { x: 40, y: 40, z: 40 },
  },
  // implicit-composite: exact features + implicit body in ONE part — the
  // sdf_kit v2 composition capability (docs/text-to-cad/04). Watertightness
  // is graded automatically; network isolation needs the sidecar's
  // check_networks (run manually / agentically for now).
  {
    id: "heat-exchanger-core",
    tier: "implicit-composite",
    prompt:
      "a two-fluid counterflow heat exchanger core, 50mm diameter x 60mm tall cylindrical jacket, gyroid sheet separator, 2mm walls — the two fluid networks must be fully isolated",
    expectedDims: { x: 50, y: 50, z: 60 },
  },
  {
    id: "lattice-bracket",
    tier: "implicit-composite",
    prompt:
      "a lightweight L-bracket, 60x60mm legs, 12mm thick, with two exact M5 bolt bosses per leg and a gyroid lattice core inside a 2mm solid skin",
  },
  // Drape recipe regression gate (MTR-192): a bare "enclose these components"
  // prompt with no style must yield a two-piece, cavity-fitting assembly by
  // default. Asserts the two-part contract + honesty on the plan-form.
  {
    id: "drape-enclosure-two-piece",
    tier: "assembly",
    prompt:
      "an enclosure for a 60x40x12 mm PCB and a 50x30x13 mm battery, two-piece",
    expectations: {
      dims: [
        { label: "two printed parts", kind: "count", of: "part", value: 2 },
      ],
      negativeChecks: [
        "the two shells are translated apart / exploded rather than sitting in their assembled position",
        "a boxy extruded-rectangle shell with corner fillets instead of a continuous soft plan-form",
      ],
    },
  },

  // ── CAD Skills benchmark seed set (MTR-201) ──────────────────────────────
  {
    id: "bench-calibration-block",
    tier: "benchmark",
    prompt:
      "a 3D-printer calibration block, 50 x 50 x 10 mm, with a 20 mm diameter through-hole centered on the top face and a 10 mm wide x 5 mm deep slot across the top",
    expectations: {
      dims: [
        { label: "length", kind: "bbox_span", axis: "x", value: 50, tolerance: 0.5 },
        { label: "width", kind: "bbox_span", axis: "y", value: 50, tolerance: 0.5 },
        { label: "height", kind: "bbox_span", axis: "z", value: 10, tolerance: 0.5 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
        { label: "bore diameter", kind: "diameter", value: 20, tolerance: 0.3 },
      ],
      negativeChecks: [
        "any chamfer or fillet on the through-hole",
        "extra bosses, text, logos, or decorative geometry not requested",
      ],
    },
  },
  {
    id: "bench-circular-flange",
    tier: "benchmark",
    prompt:
      "a circular pipe flange, 120 mm outer diameter, 20 mm thick, with a 60 mm diameter center bore and six 10 mm bolt holes on a 95 mm bolt circle",
    expectations: {
      dims: [
        { label: "outer diameter x", kind: "bbox_span", axis: "x", value: 120, tolerance: 1 },
        { label: "outer diameter y", kind: "bbox_span", axis: "y", value: 120, tolerance: 1 },
        { label: "thickness", kind: "bbox_span", axis: "z", value: 20, tolerance: 0.5 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
        { label: "center bore diameter", kind: "diameter", value: 60, tolerance: 0.5 },
      ],
      negativeChecks: [
        "the bolt holes are not evenly spaced around the bolt circle",
        "the center bore is missing or off-center",
      ],
    },
  },
  {
    id: "bench-l-bracket-gussets",
    tier: "benchmark",
    prompt:
      "a right-angle L-bracket, 80 x 80 mm legs, 60 mm wide, 6 mm thick, with two triangular gusset ribs stiffening the inside corner and two 8 mm mounting holes per leg",
    expectations: {
      dims: [
        { label: "leg span x", kind: "bbox_span", axis: "x", value: 80, tolerance: 1 },
        { label: "leg span z", kind: "bbox_span", axis: "z", value: 80, tolerance: 1 },
        { label: "width", kind: "bbox_span", axis: "y", value: 60, tolerance: 1 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "the gusset ribs are missing",
        "the two legs are not at a right angle",
      ],
    },
  },
  {
    id: "bench-stepped-shaft-keyway",
    tier: "benchmark",
    prompt:
      "a stepped shaft, 100 mm long: a 20 mm diameter section 60 mm long stepping down to a 12 mm diameter section 40 mm long, with a 4 mm wide x 4 mm deep keyway cut into the larger section",
    expectations: {
      dims: [
        { label: "overall length", kind: "bbox_span", axis: "z", value: 100, tolerance: 1 },
        { label: "large diameter", kind: "bbox_span", axis: "x", value: 20, tolerance: 0.5 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "the two diameters are the same (no step)",
        "the keyway is missing",
      ],
    },
  },
  {
    id: "bench-open-top-enclosure-bosses",
    tier: "benchmark",
    prompt:
      "an open-top rectangular enclosure, 100 x 70 x 40 mm outside, 2.5 mm walls, with four internal screw bosses (5 mm OD, 2.5 mm pilot) in the corners inset 6 mm",
    expectations: {
      dims: [
        { label: "length", kind: "bbox_span", axis: "x", value: 100, tolerance: 1 },
        { label: "width", kind: "bbox_span", axis: "y", value: 70, tolerance: 1 },
        { label: "height", kind: "bbox_span", axis: "z", value: 40, tolerance: 1 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "the enclosure is closed on top (not open)",
        "the corner bosses are missing",
      ],
    },
  },
  {
    id: "bench-clevis-bracket",
    tier: "benchmark",
    prompt:
      "a clevis bracket: a U-shaped yoke with two parallel 8 mm-thick ears 30 mm apart, each with a coaxial 10 mm pin hole, on a 50 x 50 mm base plate with four corner mounting holes",
    expectations: {
      dims: [
        { label: "base plate x", kind: "bbox_span", axis: "x", value: 50, tolerance: 1 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
        { label: "pin hole diameter", kind: "diameter", value: 10, tolerance: 0.3 },
      ],
      negativeChecks: [
        "the two ear pin holes are not coaxial",
        "the two ears are fused together with no gap between them",
      ],
    },
  },
  {
    id: "bench-finned-cylinder",
    tier: "benchmark",
    prompt:
      "a finned heat-sink cylinder, 40 mm diameter x 60 mm tall core, with eight radial cooling fins 2 mm thick and 12 mm deep running the full height",
    expectations: {
      dims: [
        { label: "overall height", kind: "bbox_span", axis: "z", value: 60, tolerance: 1 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "fewer than eight fins",
        "the fins are disconnected from the core",
      ],
    },
  },
  {
    id: "bench-centrifugal-impeller",
    tier: "benchmark",
    prompt:
      "a centrifugal pump impeller, 80 mm outer diameter, with six backward-curved vanes on a 10 mm thick back disk and a 12 mm center bore for the shaft",
    expectations: {
      dims: [
        { label: "outer diameter x", kind: "bbox_span", axis: "x", value: 80, tolerance: 1.5 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "fewer than six vanes",
        "the vanes are straight/radial rather than backward-curved",
        "the center shaft bore is missing",
      ],
    },
  },
  {
    id: "bench-spiral-staircase",
    tier: "benchmark",
    prompt:
      "a model spiral staircase, 100 mm diameter, 200 mm tall, with twelve treads winding 360 degrees around a 15 mm center column",
    expectations: {
      dims: [
        { label: "overall height", kind: "bbox_span", axis: "z", value: 200, tolerance: 3 },
        { label: "outer diameter x", kind: "bbox_span", axis: "x", value: 100, tolerance: 2 },
        { label: "one solid", kind: "count", of: "solid", value: 1 },
      ],
      negativeChecks: [
        "the treads are not helically arranged (they do not wind around the column)",
        "fewer than twelve treads",
      ],
    },
  },
  {
    id: "bench-planetary-gear-stage",
    tier: "benchmark",
    prompt:
      "a planetary gear stage (module 1): a central sun gear, three planet gears, and an internal ring gear, all coplanar and meshing, with the ring teeth facing inward",
    expectations: {
      dims: [
        { label: "meshing parts", kind: "count", of: "part", value: 5 },
      ],
      negativeChecks: [
        "the ring gear teeth face outward instead of inward",
        "the planet gears are fused into the sun or ring gear instead of being separate meshing parts",
        "fewer than three planet gears",
      ],
    },
  },
];
