import type { CadEngineId } from "../../lib/cad/engines";

/**
 * Frozen bake-off set for the B-rep vs implicit engine comparison.
 *
 * SEEDED FROM PRODUCTION FAILURES, not from intuition. Every case tagged
 * `seed: "production"` is a real prompt that failed a real generation, taken
 * from the 12 recorded failures (scripts/cad-failure-detail.ts). Six of those
 * twelve were genuine geometry failures and every one was a loft, a spline
 * blend, an organic enclosure, or a two-fluid core.
 *
 * FAIRNESS IS THE POINT. A set made only of prompts the implicit engine
 * should win would prove nothing, so `expectedEdge` records — BEFORE the run
 * — which engine the case is expected to favour, and the set deliberately
 * includes `brep` cases: crisp prismatic parts, threaded features, and
 * assemblies where a CSG kernel is simply the right tool. If the implicit
 * engine loses those, that is the comparison working, not a problem with the
 * set. A scorecard that does not split by expectedEdge can be read to say
 * whatever the reader already believed.
 */

export type BenchCategory =
  | "organic-blend"
  | "enclosure"
  | "mechanical"
  | "implicit"
  | "assembly";

export interface BenchCase {
  id: string;
  category: BenchCategory;
  prompt: string;
  /** Where the prompt came from. "production" = a real recorded failure. */
  seed: "production" | "authored";
  /**
   * Which engine this case is expected to favour, declared up front so the
   * scorecard can be read honestly. "either" = no prior.
   */
  expectedEdge: CadEngineId | "either";
  /** What the recorded production run did, when this is a seeded case. */
  priorOutcome?: string;
  /** Rough bounding box (mm) for a sanity check on the produced mesh. */
  approxSizeMm?: [number, number, number];
}

export const BENCH_CASES: BenchCase[] = [
  // ── Seeded from recorded production failures ────────────────────────────
  {
    id: "intercooler-core",
    category: "implicit",
    prompt:
      "Create an air-to-water intercooler with a core that's roughly 120mm x 80mm x 60mm. " +
      "The hot fluid (air) and the coolant must stay in separate, isolated circuits, " +
      "each with its own inlet and outlet.",
    seed: "production",
    expectedEdge: "sdf",
    priorOutcome: "failed after 307s, 8 attempts: agent produced no runnable result",
    approxSizeMm: [120, 80, 60],
  },
  {
    id: "esp32-organic-case",
    category: "enclosure",
    prompt:
      "A rounded, organic ESP32 case with stilts underneath so the solder traces have " +
      "clearance, and a USB-C charging cutout on one edge.",
    seed: "production",
    expectedEdge: "sdf",
    priorOutcome: "failed after 203s, 12 attempts: no valid result",
  },
  {
    id: "hook-organic-blend",
    category: "organic-blend",
    prompt:
      "A wall hook where the two prongs tie organically into the body — lofted and " +
      "blended into one flowing form rather than joined primitives.",
    seed: "production",
    expectedEdge: "sdf",
    priorOutcome:
      "failed after 287s: not watertight, euler number 2, 4 faces on open boundary edges",
  },
  {
    id: "hook-spline-prongs",
    category: "organic-blend",
    prompt:
      "A wall hook whose prongs follow a swept spline from the mounting plate through " +
      "the bend and out to the tips, with a smooth continuous transition at the bend.",
    seed: "production",
    expectedEdge: "sdf",
    priorOutcome: "failed after 299s: did not compile, not a solid, non-manifold",
  },
  {
    id: "double-hook",
    category: "organic-blend",
    prompt:
      "A wall hook with two long hooks rather than short prongs, blended smoothly " +
      "into a single mounting body.",
    seed: "production",
    expectedEdge: "sdf",
    priorOutcome: "failed after 83s: fillet radius too large",
  },
  {
    id: "pegboard-attachment",
    category: "mechanical",
    prompt:
      "A modular pegboard attachment for holding custom tools and general bits. " +
      "It should sit stably in the board and not rock.",
    seed: "production",
    expectedEdge: "either",
    priorOutcome: "4 recorded failures, all 'generation failed' with no diagnosis",
  },

  // ── Authored: where a B-rep kernel should win ───────────────────────────
  {
    id: "prismatic-bracket",
    category: "mechanical",
    prompt:
      "An L-bracket 60mm x 40mm x 4mm thick with two M5 clearance holes on each leg, " +
      "and a 2mm chamfer on the outer edges.",
    seed: "authored",
    expectedEdge: "brep",
    approxSizeMm: [60, 40, 40],
  },
  {
    id: "threaded-boss-plate",
    category: "mechanical",
    prompt:
      "A 50mm square mounting plate 5mm thick with four M3 heat-set insert bosses, " +
      "one at each corner, 8mm tall.",
    seed: "authored",
    expectedEdge: "brep",
    approxSizeMm: [50, 50, 13],
  },
  {
    id: "gear-pair",
    category: "mechanical",
    prompt: "A pair of meshing spur gears, 20 and 40 teeth, 2mm module, 6mm face width.",
    seed: "authored",
    expectedEdge: "brep",
  },
  {
    id: "snap-fit-lid-box",
    category: "assembly",
    prompt:
      "A two-piece box, 70mm x 50mm x 30mm, with a snap-fit lid. Lid and base as " +
      "separate printed parts.",
    seed: "authored",
    expectedEdge: "brep",
    approxSizeMm: [70, 50, 30],
  },
  {
    id: "hinged-enclosure",
    category: "assembly",
    prompt:
      "A hinged clamshell enclosure 80mm x 60mm x 35mm with pin bores for a 3mm hinge " +
      "pin, printed as two parts.",
    seed: "authored",
    expectedEdge: "either",
    approxSizeMm: [80, 60, 35],
  },

  // ── Authored: where the implicit engine should win ──────────────────────
  {
    id: "lattice-bracket",
    category: "implicit",
    prompt:
      "A load-bearing bracket with a graded gyroid lattice infill, denser along the " +
      "load path, mounting to a wall with two M6 bolts.",
    seed: "authored",
    expectedEdge: "sdf",
  },
  {
    id: "ergonomic-handle",
    category: "organic-blend",
    prompt:
      "An ergonomic pull handle with finger relief, flowing smoothly into two " +
      "mounting pads 96mm apart with M4 clearance holes.",
    seed: "authored",
    expectedEdge: "sdf",
    approxSizeMm: [130, 30, 35],
  },
  {
    id: "draped-component-shell",
    category: "enclosure",
    prompt:
      "A soft, pebble-like enclosure draped over a 40mm x 25mm x 12mm PCB with a " +
      "18650 cell beside it, one continuous surface, 2mm wall, split into two " +
      "printed halves.",
    seed: "authored",
    expectedEdge: "sdf",
  },
  {
    id: "vented-fan-shroud",
    category: "organic-blend",
    prompt:
      "A fan shroud transitioning from an 80mm round inlet to a 60mm x 40mm " +
      "rectangular outlet over 70mm, with a smooth continuous wall.",
    seed: "authored",
    expectedEdge: "sdf",
    approxSizeMm: [80, 80, 70],
  },

  // ── Control: trivial, both engines must pass ────────────────────────────
  {
    id: "control-cube",
    category: "mechanical",
    prompt: "A 20mm cube with a 6mm hole through the middle of one face.",
    seed: "authored",
    expectedEdge: "either",
    approxSizeMm: [20, 20, 20],
  },
];

/** Cases seeded from real recorded failures. */
export function productionSeeded(): BenchCase[] {
  return BENCH_CASES.filter((c) => c.seed === "production");
}
