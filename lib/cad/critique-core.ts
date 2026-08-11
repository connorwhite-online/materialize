/**
 * Pure (no `server-only`) core of the VLM aesthetic judge: the rubric, the
 * 0-5 anchored dimensions + weights, the pass thresholds, and the response
 * parser. Kept free of the model/credential code in critique.ts so the
 * standalone eval runner (scripts/evals) can score renders with the SAME
 * rubric + aggregation the harness uses — no drift between "what the harness
 * judges" and "what the evals measure".
 */

import type { CadBrief } from "./brief";

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

/**
 * The generator's stated design intent (MTR-223, after Seek-CAD): the plan
 * step's text and/or the design brief, threaded to the judge so it critiques
 * intent-vs-outcome instead of outcome alone. Optional and additive — with no
 * intent the judge prompt is byte-identical to the pre-MTR-223 one.
 */
export interface JudgeIntent {
  /** The plan step's short design plan (or the agent's opening plan text). */
  plan?: string;
  /** The design brief the generation was built against. */
  brief?: CadBrief;
  /**
   * How many user-attached reference images follow the clay renders in the
   * judge call (0/absent = none — prompt byte-identical to before). The
   * references show the GOAL; resemblance to them is scoreable.
   */
  referenceCount?: number;
}

/**
 * Framing for the intent block. The guard sentence is load-bearing: the known
 * failure mode of intent-aware judging is sycophancy — grading the stated
 * intent instead of the pixels — so the rubric must pin the judge to the
 * rendered result.
 */
const INTENT_FRAMING =
  "Design intent (from the generator) — use this to understand what was attempted. Judge ONLY the rendered result against the user's request; intent explains choices, it never excuses visual defects.";

/**
 * Framing for user-attached reference images. Same sycophancy guard as
 * intent: the references say what was WANTED, the clay renders say what was
 * BUILT — only the renders get graded.
 */
const REFERENCE_FRAMING =
  "After the clay renders, reference image(s) are attached (each captioned: the user's own references and/or the concept render this build aimed toward). They show the GOAL: weigh resemblance to them when scoring recognizability and proportion. Grade only the clay renders — the references explain the target, they never excuse defects.";

/**
 * Build the judge's user prompt. Pure and shared (harness judge + tests) so
 * the intent framing can't drift between call sites. Without intent the
 * output is exactly `Requested object: <prompt>` — unchanged from before.
 */
export function buildJudgePrompt(prompt: string, intent?: JudgeIntent): string {
  const base = `Requested object: ${prompt}`;
  const blocks: string[] = [];
  if (intent?.plan) blocks.push(`Plan:\n${intent.plan}`);
  if (intent?.brief) blocks.push(`Brief: ${JSON.stringify(intent.brief)}`);
  const parts = [base];
  if (blocks.length > 0) parts.push(INTENT_FRAMING, ...blocks);
  if (intent?.referenceCount) parts.push(REFERENCE_FRAMING);
  return parts.join("\n\n");
}

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
