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
      role: "route",
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

/**
 * Best-of-N (docs/text-to-cad/07): sample N independent scripted generations
 * for a FRESH build and keep the judge's favorite — codegen variance is high,
 * and selection converts it into quality at linear cost. Default 1 (off);
 * CAD_BEST_OF=2|3 enables. Revisions are excluded (they converge on a prior,
 * variance is the enemy there), as is the agentic path (already iterative).
 */
function bestOfN(): number {
  const n = Number(process.env.CAD_BEST_OF);
  return Number.isFinite(n) ? Math.max(1, Math.min(3, Math.floor(n))) : 1;
}

/** Judge-selected winner among candidates; first ok result as tiebreak. */
async function runBestOf(
  input: HarnessInput,
  n: number
): Promise<HarnessResult> {
  // Only the first candidate streams progress — N interleaved event streams
  // would render as UI noise; the others run silently. Interactive questions
  // (MTR-191) are stripped from the silent candidates too: a background
  // candidate must never suspend on user input (nothing surfaces its card, and
  // it would block the whole Promise.all).
  const runs = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      runHarness(
        i === 0
          ? input
          : { ...input, onProgress: undefined, onQuestion: undefined }
      ).catch(() => null)
    )
  );
  const ok = runs.filter(
    (r): r is HarnessResult => !!r && r.ok && !!r.run
  );
  if (ok.length === 0) {
    // All failed — surface the streaming candidate's failure (or any).
    return (
      runs.find((r): r is HarnessResult => !!r) ?? {
        ok: false,
        sourceCode: "",
        attempts: 0,
        error: "generation failed",
      }
    );
  }
  const winner = ok.reduce((best, r) =>
    (r.aestheticScore ?? -1) > (best.aestheticScore ?? -1) ? r : best
  );
  return winner;
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
    const n = !input.priorSourceCode && !useGenerative ? bestOfN() : 1;
    const result = await (useGenerative
      ? generative()
      : n > 1
        ? runBestOf(input, n)
        : runHarness(input));
    return { ...result, route: n > 1 ? `legacy-bestof${n}` : "legacy" };
  }

  const kind = await classifyCadRequest(input.prompt, input.signal);
  if (kind === "organic" && generativeEnabled()) {
    return { ...(await generative()), route: "organic" };
  }
  if (kind === "complex") {
    try {
      return { ...(await runAgenticHarness(input)), route: "complex" };
    } catch (err) {
      // Abort = the caller hung up, not an agentic failure — propagate.
      if ((err as Error)?.name === "AbortError") throw err;
      logError("runCadGeneration:agentic-fallback", err);
      return { ...(await runHarness(input)), route: "complex-fallback" };
    }
  }
  const n = !input.priorSourceCode ? bestOfN() : 1;
  if (n > 1) {
    return { ...(await runBestOf(input, n)), route: `simple-bestof${n}` };
  }
  return { ...(await runHarness(input)), route: "simple" };
}
