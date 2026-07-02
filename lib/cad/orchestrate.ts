import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { modelForRole } from "./models";
import { runHarness, type HarnessInput, type HarnessResult } from "./harness";
import { runAgenticHarness } from "./agentic";
import {
  generativeEnabled,
  shouldUseGenerative,
  runGenerative,
} from "./generative";
import { sessionsAvailable } from "./session-client";
import { logError } from "@/lib/logger";

/**
 * Single generation entry point with complexity routing (docs/text-to-cad/03
 * §C): the cheap scripted loop stays the default and the fallback; the
 * agentic session loop is spent only on parts that need it.
 *
 *   no credentials / CAD_AGENTIC=false / no sessions → today's behavior
 *     (shouldUseGenerative → runGenerative | runHarness), byte-identical.
 *   else classify: simple → runHarness · organic → runGenerative (when
 *     enabled) · complex → runAgenticHarness, falling back to runHarness on
 *     any agentic infrastructure failure.
 *
 * runHarness / runGenerative keep their exports — existing callers compile
 * and behave unchanged; this is additive routing on top.
 */

export type CadRequestClass = "simple" | "complex" | "organic";

/**
 * Three-way complexity routing (extends the shouldUseGenerative router
 * pattern). One cheap completion on the plan role's model; ANY doubt or
 * failure → "simple" — the scripted loop is always a safe landing.
 */
export async function classifyCadRequest(
  prompt: string,
  signal?: AbortSignal
): Promise<CadRequestClass> {
  try {
    const verdict = await completeText({
      system:
        "You route a 3D-model request to the right engine. Reply with ONE word:\n" +
        "SIMPLE — a straightforward part a short parametric script gets right in one or two tries (primitive-based shapes, plates, trays, knobs, simple brackets/enclosures, anything under ~5 distinct features).\n" +
        "COMPLEX — a functional/mechanical part needing MANY coordinated features or steps (multi-feature enclosures with several ports/bosses/vents, assemblies, interlocking or multi-constraint geometry) that benefits from being built and validated incrementally.\n" +
        "ORGANIC — a NON-functional sculptural / character / creature / figurine / decorative form with no precise functional features (best made by a generative 3D model).\n" +
        "When in doubt, SIMPLE.\n" +
        "Reply with only the single word.",
      prompt,
      model: modelForRole("plan"),
      signal,
    });
    if (/\bORGANIC\b/i.test(verdict)) return "organic";
    if (/\bCOMPLEX\b/i.test(verdict)) return "complex";
    return "simple";
  } catch (err) {
    logError("classifyCadRequest", err);
    return "simple";
  }
}

function agenticEnabled(): boolean {
  return (
    hasModelCredentials() &&
    process.env.CAD_AGENTIC !== "false" &&
    sessionsAvailable()
  );
}

/**
 * The one entry the route/worker calls. Same input/result contract as
 * runHarness — persistence downstream is agnostic to which engine ran.
 */
export async function runCadGeneration(
  input: HarnessInput
): Promise<HarnessResult> {
  const generative = () =>
    runGenerative({
      prompt: input.prompt,
      images: input.images,
      signal: input.signal,
      onProgress: input.onProgress,
    });

  if (!agenticEnabled()) {
    // Kill switch / no sessions / no model: today's behavior, unchanged.
    const useGenerative =
      generativeEnabled() &&
      (await shouldUseGenerative(input.prompt, input.signal));
    return useGenerative ? generative() : runHarness(input);
  }

  const kind = await classifyCadRequest(input.prompt, input.signal);
  if (kind === "organic" && generativeEnabled()) return generative();
  if (kind === "complex") {
    try {
      return await runAgenticHarness(input);
    } catch (err) {
      // Abort = the caller hung up, not an agentic failure — propagate.
      if ((err as Error)?.name === "AbortError") throw err;
      logError("runCadGeneration:agentic-fallback", err);
      return runHarness(input);
    }
  }
  return runHarness(input);
}
