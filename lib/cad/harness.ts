import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { runCadCode } from "./runner-client";
import { SYSTEM_PROMPT, extractCode, gradeRun } from "./prompt";
import { buildKnowledgeBlock, type CadProcess } from "./knowledge";
import { judgeAesthetics } from "./critique";
import { selectExemplars, formatExemplars } from "./knowledge/exemplars";
import type { CadProgressEvent, CadRunResult } from "./types";

/**
 * The text-to-CAD harness. The harness — not a bespoke model — is the
 * product: an LLM emits parametric build123d, we execute it in the sidecar,
 * check validity, and on failure feed the error back for a repair turn.
 *
 * Output contract (also enforced in the sidecar): the script must assign
 * its final solid to a variable named `result` (a build123d object). We
 * export STL (printable) + STEP (editable) from it.
 *
 * SYSTEM_PROMPT / extractCode / gradeRun live in ./prompt (pure, shared
 * with the eval runner).
 */

const MAX_ATTEMPTS_DEFAULT = 3;

export interface HarnessInput {
  prompt: string;
  /** When editing an existing generation, its source code to revise. */
  priorSourceCode?: string | null;
  maxAttempts?: number;
  signal?: AbortSignal;
  /**
   * Target CraftCloud process, if known at generation time. Drives which DFM
   * block is injected; when omitted the harness uses the conservative
   * multi-process envelope (generation often precedes material selection).
   */
  process?: CadProcess | null;
  /**
   * Called as the loop advances so the caller can stream status to the UI.
   * Best-effort and synchronous — the harness never awaits it and a throw
   * here must not derail a generation.
   */
  onProgress?: (event: CadProgressEvent) => void;
}

export interface HarnessResult {
  ok: boolean;
  sourceCode: string;
  attempts: number;
  /** The last sidecar run (carries files, render, geometry, validation). */
  run?: CadRunResult;
  /** VLM aesthetic aggregate (0-100), null when the judge is off/unavailable. */
  aestheticScore?: number | null;
  error?: string;
}

/**
 * Credential-free fallback so the whole pipeline is demoable without a
 * model key (mirrors the CraftCloud / runner mock philosophy). Emits a
 * parametric cube sized from the first number found in the prompt.
 */
function localFakeModel(prompt: string, prior?: string | null): string {
  if (prior) return prior;
  const n = prompt.match(/(\d+(?:\.\d+)?)\s*(mm|cm|in)?/i);
  const size = n ? Number(n[1]) : 20;
  return [
    "from build123d import *",
    "",
    `size = ${Number.isFinite(size) ? size : 20}`,
    "with BuildPart() as part:",
    "    Box(size, size, size)",
    "result = part.part",
    "",
  ].join("\n");
}

function buildUserPrompt(input: HarnessInput): string {
  const task = input.priorSourceCode
    ? [
        "Revise the following build123d model per this instruction:",
        `Instruction: ${input.prompt}`,
        "",
        "Current code:",
        "```python",
        input.priorSourceCode,
        "```",
      ].join("\n")
    : `Create a 3D model: ${input.prompt}`;

  const knowledge = buildKnowledgeBlock({
    prompt: input.prompt,
    process: input.process,
  });

  let out = `${task}\n\nDesign guidance to follow:\n\n${knowledge}`;

  // On a fresh build, show the best-matching verified exemplar as a style
  // reference. (Revisions already have the prior code as their reference.)
  // Returns "" until exemplars are sidecar-verified, so this is a no-op now.
  if (!input.priorSourceCode) {
    const exemplars = formatExemplars(selectExemplars(input.prompt));
    if (exemplars) out += `\n\n${exemplars}`;
  }

  return out;
}

/**
 * Run the generate -> execute -> validate -> repair loop. Returns the last
 * attempt's code + run regardless of success so the caller can persist the
 * full record (the failed code is still useful flywheel data).
 */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS_DEFAULT;
  const useModel = hasModelCredentials();

  // Swallow listener errors — progress is cosmetic, never load-bearing.
  const emit = (event: CadProgressEvent) => {
    try {
      input.onProgress?.(event);
    } catch {
      /* ignore */
    }
  };

  let lastCode = "";
  let lastRun: CadRunResult | undefined;
  let repairNote = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal?.aborted) break;

    emit({ type: "phase", phase: "generating", attempt, maxAttempts });
    if (useModel) {
      const userPrompt = repairNote
        ? `${buildUserPrompt(input)}\n\nThe previous attempt failed because ${repairNote}. Here is that code:\n\`\`\`python\n${lastCode}\n\`\`\`\nFix it.`
        : buildUserPrompt(input);
      const text = await completeText({
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        signal: input.signal,
      });
      lastCode = extractCode(text);
    } else {
      // No credentials: deterministic local fallback, no repair value.
      lastCode = localFakeModel(input.prompt, input.priorSourceCode);
    }

    emit({ type: "phase", phase: "executing", attempt, maxAttempts });
    lastRun = await runCadCode(lastCode, ["stl", "step"], input.signal);

    const grade = gradeRun(lastRun);
    emit({
      type: "validation",
      attempt,
      maxAttempts,
      pass: grade.pass,
      failures: grade.failures,
      validation: lastRun.validation,
    });
    if (grade.pass) {
      // Geometrically valid — now (optionally) judge it aesthetically. The
      // judge is gated off by default, so this is a no-op unless enabled.
      const judgement = await judgeAesthetics({
        renderPng: lastRun.renderPng,
        prompt: input.prompt,
        signal: input.signal,
      });
      const aestheticScore = judgement.available
        ? (judgement.score ?? null)
        : null;

      // Spend a repair turn on a visually-weak (but printable) result when we
      // have budget and a model. Otherwise accept it.
      if (
        judgement.available &&
        judgement.pass === false &&
        useModel &&
        attempt < maxAttempts
      ) {
        repairNote = `the design is printable but visually weak — ${judgement.feedback}`;
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      return {
        ok: true,
        sourceCode: lastCode,
        attempts: attempt,
        run: lastRun,
        aestheticScore,
      };
    }

    repairNote = grade.failures.join("; ");
    // The local fallback is deterministic — repairing it is pointless.
    if (!useModel) break;
    if (attempt < maxAttempts) {
      emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
    }
  }

  return {
    ok: false,
    sourceCode: lastCode,
    attempts: maxAttempts,
    run: lastRun,
    error: repairNote || "generation failed",
  };
}
