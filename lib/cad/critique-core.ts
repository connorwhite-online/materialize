/**
 * Pure (no `server-only`) core of the VLM aesthetic judge: the rubric, the
 * 0-5 anchored dimensions + weights, the pass thresholds, and the response
 * parser. Kept free of the model/credential code in critique.ts so the
 * standalone eval runner (scripts/evals) can score renders with the SAME
 * rubric + aggregation the harness uses — no drift between "what the harness
 * judges" and "what the evals measure".
 */

export const AESTHETIC_DIMENSIONS = [
  "recognizability",
  "proportion",
  "cohesion",
  "surfacing",
  "refinement",
] as const;
export type AestheticDimension = (typeof AESTHETIC_DIMENSIONS)[number];

const WEIGHTS: Record<AestheticDimension, number> = {
  recognizability: 1,
  proportion: 2,
  cohesion: 2,
  surfacing: 1,
  refinement: 1,
};

/** Aggregate (0-100) at/above which a part passes the aesthetic gate. Set high
 *  — this is a product-design bar; weak-but-valid parts should earn a repair. */
export const PASS_THRESHOLD = 75;
/** Any single dimension at/below this (0-5) fails regardless of the mean. */
const PER_DIMENSION_FLOOR = 1;

export const CRITIQUE_RUBRIC = `You are an industrial/product designer judging a NEUTRAL GRAY CLAY render of a 3D-printable part. Judge the DESIGN — form, proportion, resolution, finish — NOT color, material, or lighting. Reward clean, intentional, restrained product design; do NOT reward busyness or added detail for its own sake.

You are given one or more clay renders (typically two opposed isometric views plus top/front, and a section cutaway for hollow parts). Visual review is DIAGNOSTIC, not authoritative: judge only the DESIGN QUALITY you can actually SEE. Do NOT assert structural safety, tolerance compliance, dimensional accuracy, or manufacturability — those are checked deterministically elsewhere, not by you. If a face is not visible in any view, do not guess about it.

Score each dimension 0-5 (0 worst, 5 best):
- recognizability: is it unambiguously the requested object/part? (5 = instantly correct)
- proportion: believable, balanced, intentional proportions and stance — it reads right and sits right (5 = beautifully proportioned)
- cohesion: ONE cohesive, fully-resolved form — every feature connects and belongs; NO disjointed, floating, stray, or unmerged pieces (5 = seamless single object, 0 = scattered/disconnected parts)
- surfacing: deliberate edge treatment — a consistent fillet/chamfer hierarchy, crisp intentional edges, smooth continuous surfaces, no lumps or raw sharp edges (5 = refined)
- refinement: reads as a deliberately designed, desirable product — restrained and considered, not a generative accident or over-busy (5 = looks designed)

Output ONLY strict JSON, no prose:
{"recognizability":{"score":N,"reason":"...","fix":"..."},"proportion":{...},"cohesion":{...},"surfacing":{...},"refinement":{...}}
A longer reason does not mean a lower score.`;

export interface DimensionScore {
  score: number;
  reason: string;
  fix: string;
}

export interface AestheticJudgement {
  available: boolean;
  /** Weighted aggregate, 0-100 (present when available). */
  score?: number;
  pass?: boolean;
  perDimension?: Record<string, DimensionScore>;
  /** Actionable critique (the `fix` of weak dimensions) for a repair turn. */
  feedback?: string;
}

/**
 * Parse the judge's JSON into a 0-100 aggregate + repair feedback. Pure and
 * defensive — returns null on any malformed response. Exported for tests.
 */
export function parseJudgement(text: string): {
  score: number;
  pass: boolean;
  perDimension: Record<string, DimensionScore>;
  feedback: string;
} | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, Partial<DimensionScore>>;

  const perDimension: Record<string, DimensionScore> = {};
  let weighted = 0;
  let weightTotal = 0;
  let belowFloor = false;
  for (const dim of AESTHETIC_DIMENSIONS) {
    const d = obj[dim];
    if (!d || typeof d.score !== "number") return null; // require all dims
    const score = Math.max(0, Math.min(5, d.score));
    perDimension[dim] = {
      score,
      reason: typeof d.reason === "string" ? d.reason : "",
      fix: typeof d.fix === "string" ? d.fix : "",
    };
    weighted += score * WEIGHTS[dim];
    weightTotal += WEIGHTS[dim];
    if (score <= PER_DIMENSION_FLOOR) belowFloor = true;
  }

  const aggregate = Math.round((weighted / weightTotal / 5) * 100);
  const pass = aggregate >= PASS_THRESHOLD && !belowFloor;

  // Feedback = the fixes for the weakest dimensions (score <= 3).
  const fixes = AESTHETIC_DIMENSIONS.filter(
    (d) => perDimension[d].score <= 3 && perDimension[d].fix
  ).map((d) => `${d}: ${perDimension[d].fix}`);

  return { score: aggregate, pass, perDimension, feedback: fixes.join("; ") };
}
