import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { modelForRole } from "./models";
import { logError } from "@/lib/logger";
import {
  CRITIQUE_RUBRIC,
  parseJudgement,
  type AestheticJudgement,
} from "./critique-core";

/**
 * VLM aesthetic judge — renders a generated part to a neutral clay PNG and
 * asks a vision model to score it against a fixed rubric, so the harness can
 * do a render -> critique -> repair turn and "visually decent" becomes
 * measurable. The rubric, dimensions, and parser are in ./critique-core (pure)
 * so the eval runner scores with the identical oracle.
 *
 * Design follows the research: 0-5 anchored rubric, score AFTER per-dimension
 * reasoning, judge with a DIFFERENT model than the generator where possible
 * (self-preference bias), and judge form not lighting.
 *
 * Gated + fail-open: disabled unless CAD_AESTHETIC_JUDGE === "true" AND
 * credentials exist; ANY failure returns { available: false } so it can never
 * break a generation.
 */

// Re-export the pure surface so existing importers (and tests) are unchanged.
export {
  AESTHETIC_DIMENSIONS,
  PASS_THRESHOLD,
  CRITIQUE_RUBRIC,
  parseJudgement,
  type AestheticDimension,
  type DimensionScore,
  type AestheticJudgement,
} from "./critique-core";

/** Disabled unless explicitly turned on AND credentials are present. */
export function aestheticJudgeEnabled(): boolean {
  return process.env.CAD_AESTHETIC_JUDGE === "true" && hasModelCredentials();
}

/**
 * Run the vision model on the render via the Messages API (completeText) — the
 * same path the generator uses. Deliberately NOT the Agent SDK query(): that
 * spawns a Claude Code subprocess that hangs when the harness itself runs
 * inside Claude Code. Model precedence: CAD_AESTHETIC_JUDGE_MODEL -> the
 * `critique` role -> SDK default. Bias toward a different model than the
 * generator to limit self-preference bias.
 */
async function runVisionJudge(
  prompt: string,
  pngBase64: string,
  signal?: AbortSignal
): Promise<string> {
  return completeText({
    system: CRITIQUE_RUBRIC,
    prompt: `Requested object: ${prompt}`,
    model: process.env.CAD_AESTHETIC_JUDGE_MODEL || modelForRole("critique"),
    images: [{ data: pngBase64, mediaType: "image/png" }],
    signal,
  });
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
