import "server-only";

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { hasModelCredentials } from "./model-client";
import { logError } from "@/lib/logger";

/**
 * VLM aesthetic judge — renders a generated part to a neutral clay PNG and
 * asks a vision model to score it against a fixed rubric, so the harness can
 * do a render -> critique -> repair turn and "visually decent" becomes
 * measurable. Calibrate PASS_THRESHOLD against the studio's ugly/good feedback
 * tags (bias toward catching uglies — a wasted repair turn beats shipping an
 * ugly part).
 *
 * Design follows the research: 0-5 anchored rubric, score AFTER per-dimension
 * reasoning, judge with a DIFFERENT model family than the generator where
 * possible (self-preference bias), and tell it explicitly to judge form not
 * lighting and not to reward complexity over clean minimalism.
 *
 * Gated + fail-open: disabled unless CAD_AESTHETIC_JUDGE === "true" AND
 * credentials exist; ANY failure returns { available: false } so it can never
 * break a generation. Off by default → no-op (verify against a live vision
 * model before enabling).
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

/** Disabled unless explicitly turned on AND credentials are present. */
export function aestheticJudgeEnabled(): boolean {
  return process.env.CAD_AESTHETIC_JUDGE === "true" && hasModelCredentials();
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

/** Run the vision model on the render. Defensively typed; the integration
 * point to verify against a live model before enabling the flag. */
async function runVisionJudge(
  prompt: string,
  pngBase64: string,
  signal?: AbortSignal
): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abort = new AbortController();
  if (signal) {
    if (signal.aborted) abort.abort();
    else signal.addEventListener("abort", () => abort.abort());
  }

  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "text", text: `Requested object: ${prompt}` },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: pngBase64 },
          },
        ],
      },
    };
  }

  const result = query({
    prompt: input(),
    options: {
      abortController: abort,
      systemPrompt: CRITIQUE_RUBRIC,
      allowedTools: [],
      maxTurns: 1,
      ...(process.env.CAD_AESTHETIC_JUDGE_MODEL
        ? { model: process.env.CAD_AESTHETIC_JUDGE_MODEL }
        : {}),
    },
  });

  let text = "";
  for await (const message of result) {
    if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; text?: string };
          if (b.type === "text" && typeof b.text === "string") text += b.text;
        }
      }
    }
  }
  return text;
}

export async function judgeAesthetics(opts: {
  renderPng?: string | null;
  prompt: string;
  signal?: AbortSignal;
}): Promise<AestheticJudgement> {
  if (!aestheticJudgeEnabled() || !opts.renderPng) return { available: false };
  try {
    const text = await runVisionJudge(opts.prompt, opts.renderPng, opts.signal);
    const parsed = parseJudgement(text);
    if (!parsed) return { available: false };
    return {
      available: true,
      score: parsed.score,
      pass: parsed.pass,
      perDimension: parsed.perDimension,
      feedback: parsed.feedback,
    };
  } catch (err) {
    logError("judgeAesthetics", err);
    return { available: false };
  }
}
