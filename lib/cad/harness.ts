import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { runCadCode } from "./runner-client";
import { SYSTEM_PROMPT, extractCode, gradeRun } from "./prompt";
import type { CadRunResult } from "./types";

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
}

export interface HarnessResult {
  ok: boolean;
  sourceCode: string;
  attempts: number;
  /** The last sidecar run (carries files, render, geometry, validation). */
  run?: CadRunResult;
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
  if (input.priorSourceCode) {
    return [
      "Revise the following build123d model per this instruction:",
      `Instruction: ${input.prompt}`,
      "",
      "Current code:",
      "```python",
      input.priorSourceCode,
      "```",
    ].join("\n");
  }
  return `Create a 3D model: ${input.prompt}`;
}

/**
 * Run the generate -> execute -> validate -> repair loop. Returns the last
 * attempt's code + run regardless of success so the caller can persist the
 * full record (the failed code is still useful flywheel data).
 */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS_DEFAULT;
  const useModel = hasModelCredentials();

  let lastCode = "";
  let lastRun: CadRunResult | undefined;
  let repairNote = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal?.aborted) break;

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

    lastRun = await runCadCode(lastCode, ["stl", "step"], input.signal);

    const grade = gradeRun(lastRun);
    if (grade.pass) {
      return { ok: true, sourceCode: lastCode, attempts: attempt, run: lastRun };
    }

    repairNote = grade.failures.join("; ");
    // The local fallback is deterministic — repairing it is pointless.
    if (!useModel) break;
  }

  return {
    ok: false,
    sourceCode: lastCode,
    attempts: maxAttempts,
    run: lastRun,
    error: repairNote || "generation failed",
  };
}
