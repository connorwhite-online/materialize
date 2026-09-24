import "server-only";

import {
  completeText,
  hasModelCredentials,
  type PromptImage,
} from "./model-client";
import { labelUserReferences } from "./types";
import { runWithCadTier } from "./budget";
import { modelForRole } from "./models";
import { runHarness, type HarnessInput, type HarnessResult } from "./harness";
import { runAgenticHarness, CadAgenticError } from "./agentic";
import {
  generativeEnabled,
  shouldUseGenerative,
  runGenerative,
} from "./generative";
import { sessionsAvailable } from "./session-client";
import { pickBestCandidate } from "./best-of";
import { judgeAesthetics, judgeMode } from "./critique";
import type { CadProgressEvent } from "./types";
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
  signal?: AbortSignal,
  images?: PromptImage[] | null
): Promise<CadRequestClass> {
  try {
    const refs = labelUserReferences(images);
    const verdict = await completeText({
      system:
        "You route a 3D-model request to the right engine. Reply with ONE word:\n" +
        "SIMPLE — a straightforward part a short parametric script gets right in one or two tries (primitive-based shapes, plates, trays, knobs, simple brackets/enclosures, anything under ~5 distinct features).\n" +
        "COMPLEX — a functional/mechanical part needing MANY coordinated features or steps (multi-feature enclosures with several ports/bosses/vents, assemblies, interlocking or multi-constraint geometry) that benefits from being built and validated incrementally.\n" +
        "ORGANIC — a NON-functional sculptural / character / creature / figurine / decorative form with no precise functional features (best made by a generative 3D model).\n" +
        "Reference images may be attached — classify the requested object from BOTH the text and the images (a terse prompt with a detailed photo is whatever the photo shows).\n" +
        "When in doubt, SIMPLE.\n" +
        "Reply with only the single word.",
      prompt,
      model: modelForRole("plan"),
      role: "route",
      images: refs.length ? refs : undefined,
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
 * for a FRESH build and keep the objectively best (./best-of: fewest
 * dimension and printability failures, the judge only as a tiebreak) —
 * codegen variance is high, and selection converts it into quality at
 * linear cost. Default 1 (off);
 * CAD_BEST_OF=2|3 enables. Revisions are excluded (they converge on a prior,
 * variance is the enemy there), as is the agentic path (already iterative).
 */
function bestOfN(): number {
  const n = Number(process.env.CAD_BEST_OF);
  return Number.isFinite(n) ? Math.max(1, Math.min(3, Math.floor(n))) : 1;
}

/** The objectively best candidate (./best-of); the judge breaks ties. */
async function runBestOf(
  input: HarnessInput,
  n: number
): Promise<HarnessResult> {
  // Only the first candidate streams progress — N interleaved event streams
  // would render as UI noise; the others run silently. Interactive questions
  // (MTR-191) are stripped from the silent candidates too: a background
  // candidate must never suspend on user input (nothing surfaces its card, and
  // it would block the whole Promise.all).
  // Candidate exceptions are CAPTURED, not discarded. `.catch(() => null)`
  // here used to destroy them, and the all-failed branch then returned the
  // literal "generation failed" — with nothing thrown, executeCadJob had no
  // exception to record, so cad_jobs.error_detail stayed null too. Four of
  // twelve production failures on record are that string and nothing else:
  // a third of the failure data, self-erased. Both layers are fixed here.
  const settled = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      runHarness(
        i === 0
          ? input
          : { ...input, onProgress: undefined, onQuestion: undefined }
      ).then(
        (result) => ({ result, error: undefined as unknown }),
        (error: unknown) => ({ result: null, error })
      )
    )
  );

  // A caller hang-up is not a candidate failure. The old catch swallowed
  // aborts too, so a cancelled best-of build reported itself as a generation
  // failure instead of a cancellation.
  const aborted = settled.find(
    (s) => (s.error as Error | undefined)?.name === "AbortError"
  );
  if (aborted) throw aborted.error;

  const returned = settled
    .map((s) => s.result)
    .filter((r): r is HarnessResult => !!r);
  const ok = returned.filter((r) => r.ok && !!r.run);
  if (ok.length === 0) {
    // A returned {ok:false} carries a real diagnosis (kernel stderr, failed
    // validation) — prefer it, streaming candidate first, since that is the
    // run whose progress the user watched.
    if (returned.length > 0) return returned[0];
    // Every candidate THREW. Rethrow so executeCadJob's catch records the
    // real exception + stack in cad_jobs.error_detail, instead of inventing
    // a message that discards it.
    const thrown = settled.find((s) => s.error !== undefined);
    throw thrown?.error instanceof Error
      ? thrown.error
      : new Error(
          `all ${n} best-of candidates failed: ${String(thrown?.error ?? "unknown")}`
        );
  }
  // Objective checks decide; the judge only breaks a tie (./best-of).
  return pickBestCandidate(
    ok,
    judgeMode() === "off"
      ? undefined
      : (req) => judgeAesthetics({ ...req, signal: input.signal })
  );
}

// Under a deadline, a scripted rebuild needs at least brief + plan + one
// codegen attempt + a sidecar run (~4 min realistic). With less than this
// remaining, starting it guarantees a platform kill mid-run — prefer the
// salvaged agentic result when one exists.
const MIN_SCRIPTED_FALLBACK_MS = 240_000;

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
  // Observability: stamp the routing verdict (and any engine fallback) into
  // the progress stream, so the persisted job trail records HOW the build
  // ran — before this, an agentic run that died and silently rebuilt via
  // the scripted harness was indistinguishable from a scripted-only run.
  const note = (event: CadProgressEvent) => {
    try {
      input.onProgress?.(event);
    } catch {
      /* progress is cosmetic */
    }
  };
  const generative = () =>
    runGenerative({
      prompt: input.prompt,
      images: input.images,
      signal: input.signal,
      onProgress: input.onProgress,
    });

  // An EXPLICIT engine pins the build to the scripted loop on that engine,
  // bypassing complexity routing entirely. Two reasons, both load-bearing for
  // the bake-off:
  //
  //   The agentic and generative paths carry their own prompts and cannot
  //   honour an engine choice, so letting the router send one arm there would
  //   compare two different products rather than two representations.
  //
  //   The keyword router is exactly what made the implicit engine
  //   unreachable. A caller that names an engine must get it, whether or not
  //   the prompt happens to contain a trigger word.
  //
  // Pinning the ENGINE must not also skip the BUDGET, though. This branch used
  // to return before the classifier, so it never ran inside a tier: no effort
  // cap and the maximum number of attempts, for every part. A 30mm knob then
  // ran codegen at xhigh, and Opus's adaptive thinking used the whole output
  // budget, 16k and then 32k tokens over ~8 minutes, without writing a line
  // of code (local SDF runs, 2026-09-23). The classifier is one cheap call on
  // the plan model, and its verdict sizes the budget here exactly as it does
  // for routed builds; only the path choice is overridden.
  if (input.engine) {
    const engineId = input.engine;
    const kind = await classifyCadRequest(input.prompt, input.signal, input.images);
    return runWithCadTier(kind, async (): Promise<HarnessResult> => {
      const n = !input.priorSourceCode ? bestOfN() : 1;
      const route = `engine-${engineId}${n > 1 ? `-bestof${n}` : ""}`;
      note({ type: "route", route });
      const result = await (n > 1 ? runBestOf(input, n) : runHarness(input));
      return { ...result, route };
    });
  }

  if (!agenticEnabled()) {
    // Kill switch / no sessions / no model: today's behavior, unchanged.
    const useGenerative =
      generativeEnabled() &&
      (await shouldUseGenerative(input.prompt, input.signal, input.images));
    const n = !input.priorSourceCode && !useGenerative ? bestOfN() : 1;
    const route = useGenerative
      ? "legacy-generative"
      : n > 1
        ? `legacy-bestof${n}`
        : "legacy";
    note({ type: "route", route });
    const result = await (useGenerative
      ? generative()
      : n > 1
        ? runBestOf(input, n)
        : runHarness(input));
    // Return the already-computed `route` (CAD-11) — recomputing it here
    // dropped the "legacy-generative" case entirely, so a generative run
    // came back labeled plain "legacy" and metering (lib/cad/jobs.ts) +
    // credit tiering (lib/billing/cad-credits.ts) billed the priciest
    // backend at the simple tier.
    return { ...result, route };
  }

  const kind = await classifyCadRequest(input.prompt, input.signal, input.images);

  // The verdict sets the BUDGET as well as the engine (./budget). Everything
  // below runs inside the tier it selected, so effort, tool turns, repair
  // attempts and the runaway token ceiling are all sized to the part instead
  // of to the worst part the harness has ever been asked for.
  //
  // The tier is the verdict itself, including when an `organic` request falls
  // through to the scripted loop below because the generative engine is off:
  // a sculptural form on the scripted loop is the case least likely to repay
  // xhigh codegen and four repair turns, so it keeps organic's smaller budget
  // rather than inheriting the fallback engine's.
  //
  // The classifier call above is deliberately outside — it is one cheap
  // completion on the plan role, and it is what decides the tier.
  return runWithCadTier(kind, async (): Promise<HarnessResult> => {
    if (kind === "organic" && generativeEnabled()) {
      note({ type: "route", route: "organic" });
      return { ...(await generative()), route: "organic" };
    }
    if (kind === "complex") {
      try {
        note({ type: "route", route: "complex" });
        return { ...(await runAgenticHarness(input)), route: "complex" };
      } catch (err) {
        // Abort = the caller hung up, not an agentic failure — propagate.
        if ((err as Error)?.name === "AbortError") throw err;
        logError("runCadGeneration:agentic-fallback", err);
        const reason = (err as Error)?.message ?? String(err);
        // Budget-cutoff salvage (see CadAgenticError.salvage): the structurally
        // valid best-so-far, used ONLY when the scripted fallback can't run or
        // fails — the quality rail (don't ship an unfinished exploration as if
        // it were the finished part) still prefers a full scripted rebuild.
        const salvage =
          err instanceof CadAgenticError ? err.salvage : undefined;
        const remainingMs = input.deadlineAt
          ? input.deadlineAt - Date.now()
          : Infinity;
        if (salvage && remainingMs < MIN_SCRIPTED_FALLBACK_MS) {
          note({
            type: "fallback",
            from: "agentic",
            to: "salvage",
            reason: `${reason} — too little time left for a scripted rebuild; keeping the best-so-far solid`,
          });
          return { ...salvage, route: "complex-salvage" };
        }
        note({ type: "fallback", from: "agentic", to: "scripted", reason });
        if (!salvage) {
          return { ...(await runHarness(input)), route: "complex-fallback" };
        }
        try {
          const scripted = await runHarness(input);
          if (scripted.ok) return { ...scripted, route: "complex-fallback" };
          note({
            type: "fallback",
            from: "scripted",
            to: "salvage",
            reason:
              scripted.error ??
              "scripted rebuild produced no valid result — keeping the agentic best-so-far solid",
          });
          return { ...salvage, route: "complex-salvage" };
        } catch (err2) {
          if ((err2 as Error)?.name === "AbortError") throw err2;
          logError("runCadGeneration:scripted-salvage", err2);
          note({
            type: "fallback",
            from: "scripted",
            to: "salvage",
            reason: (err2 as Error)?.message ?? String(err2),
          });
          return { ...salvage, route: "complex-salvage" };
        }
      }
    }
    const n = !input.priorSourceCode ? bestOfN() : 1;
    if (n > 1) {
      note({ type: "route", route: `simple-bestof${n}` });
      return { ...(await runBestOf(input, n)), route: `simple-bestof${n}` };
    }
    note({ type: "route", route: "simple" });
    return { ...(await runHarness(input)), route: "simple" };
  });
}
