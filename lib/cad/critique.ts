import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { modelForRole } from "./models";
import { logError } from "@/lib/logger";
import {
  CRITIQUE_RUBRIC,
  buildJudgePrompt,
  parseJudgement,
  type AestheticJudgement,
  type JudgeIntent,
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
 * Gated + fail-open: ON by default whenever model credentials exist
 * (docs/text-to-cad/07 §B) — set CAD_CRITIQUE=false to disable. ANY failure
 * returns { available: false } so it can never break a generation.
 */

// Re-export the pure surface so existing importers (and tests) are unchanged.
export {
  AESTHETIC_DIMENSIONS,
  PASS_THRESHOLD,
  CRITIQUE_RUBRIC,
  buildJudgePrompt,
  parseJudgement,
  type AestheticDimension,
  type DimensionScore,
  type AestheticJudgement,
  type JudgeIntent,
} from "./critique-core";

/** On whenever credentials are present; CAD_CRITIQUE=false disables. */
export function aestheticJudgeEnabled(): boolean {
  return process.env.CAD_CRITIQUE !== "false" && hasModelCredentials();
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
  pngs: string[],
  intent?: JudgeIntent,
  signal?: AbortSignal
): Promise<string> {
  return completeText({
    system: CRITIQUE_RUBRIC,
    prompt: buildJudgePrompt(prompt, intent),
    model: process.env.CAD_AESTHETIC_JUDGE_MODEL || modelForRole("critique"),
    role: "critique",
    images: pngs.map((data) => ({ data, mediaType: "image/png" as const })),
    signal,
  });
}

export async function judgeAesthetics(opts: {
  renderPng?: string | null;
  /**
   * Multi-view renders (docs/text-to-cad/07 §A) — when present, ALL views go
   * to the judge in one call so a single 3/4 view can't hide a defect.
   * `renderPng` remains the single-view fallback for older sidecars.
   */
  renders?: Partial<Record<string, string>> | null;
  prompt: string;
  /**
   * The generator's stated design intent (MTR-223): plan text and/or brief,
   * framed so the judge understands what was attempted but still grades only
   * the rendered result. Omitted = judge prompt identical to before.
   */
  intent?: JudgeIntent;
  signal?: AbortSignal;
}): Promise<AestheticJudgement> {
  const views = Object.values(opts.renders ?? {}).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  const images = views.length > 0 ? views : opts.renderPng ? [opts.renderPng] : [];
  if (!aestheticJudgeEnabled() || images.length === 0) {
    return { available: false };
  }
  try {
    const text = await runVisionJudge(opts.prompt, images, opts.intent, opts.signal);
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
