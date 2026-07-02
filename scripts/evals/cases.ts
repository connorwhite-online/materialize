import type { ExpectedDims } from "../../lib/cad/prompt";

/**
 * Frozen text-to-CAD eval set. Tiered by difficulty so a scorecard shows
 * where the harness's competence boundary is (not just an average). Add
 * cases over time; treat passing cases as regression tests.
 *
 * `expectedDims` (mm) is checked against the produced solid's bounding box
 * when the prompt states explicit sizes — the cheap, automatic part of the
 * manufacturability oracle. Omit it when the prompt is open-ended.
 */
export type EvalTier =
  | "primitive"
  | "bracket"
  | "container"
  | "mechanical"
  | "assembly"
  | "implicit"
  | "implicit-composite";

export interface EvalCase {
  id: string;
  tier: EvalTier;
  prompt: string;
  expectedDims?: ExpectedDims;
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
];
