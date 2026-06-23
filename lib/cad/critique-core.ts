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
  "geometric_coherence",
  "proportion",
  "edge_surface",
  "intentional",
] as const;
export type AestheticDimension = (typeof AESTHETIC_DIMENSIONS)[number];

const WEIGHTS: Record<AestheticDimension, number> = {
  recognizability: 2,
  geometric_coherence: 2,
  proportion: 1,
  edge_surface: 1,
  intentional: 1,
};

/** Aggregate (0-100) at/above which a part passes the aesthetic gate. */
export const PASS_THRESHOLD = 70;
/** Any single dimension at/below this (0-5) fails regardless of the mean. */
const PER_DIMENSION_FLOOR = 1;

export const CRITIQUE_RUBRIC = `You are judging a NEUTRAL GRAY CLAY render of a 3D-printable CAD part for industrial-design quality. Judge form, proportion, and finish — NOT color, material realism, or lighting. Clean minimalism is GOOD; do not reward added detail or visual complexity for its own sake.

Score each dimension 0-5 (0 worst, 5 best):
- recognizability: is it unambiguously the requested object? (5 = instantly correct)
- geometric_coherence: clean continuous solid, no holes/floating bits/artifacts (5 = flawless)
- proportion: believable, intentional scale relationships (5 = well-proportioned)
- edge_surface: crisp/intentional edges and fillets, smooth surfaces, not lumpy or raw-sharp (5 = deliberate)
- intentional: reads as a deliberately designed, printable part, not a generative accident (5 = looks designed)

Output ONLY strict JSON, no prose:
{"recognizability":{"score":N,"reason":"...","fix":"..."},"geometric_coherence":{...},"proportion":{...},"edge_surface":{...},"intentional":{...}}
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
