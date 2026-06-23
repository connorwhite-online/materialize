import "server-only";

import {
  completeText,
  hasModelCredentials,
  type PromptImage,
} from "./model-client";
import { runCadCode } from "./runner-client";
import { SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, extractCode, gradeRun } from "./prompt";
import { buildKnowledgeBlock, type CadProcess } from "./knowledge";
import { judgeAesthetics } from "./critique";
import { selectExemplars, formatExemplars } from "./knowledge/exemplars";
import { modelForRole, planStepEnabled, type CadRole } from "./models";
import { CAD_FEEDBACK_TAG_LABELS, type CadFeedbackTag } from "./feedback";
import type { CadProgressEvent, CadRunResult } from "./types";

/** Owner feedback on the version being revised (CON-181). */
export interface PriorFeedback {
  rating?: string | null;
  tags?: string[] | null;
  note?: string | null;
}

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
  /**
   * Owner feedback on the version being revised — folded into the prompt so a
   * revision corrects known problems (CON-181). No-op on a fresh build.
   */
  priorFeedback?: PriorFeedback | null;
  /** Reference images the user attached, passed to the generate steps. */
  images?: PromptImage[] | null;
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
  /** Per-role model usage for routing/telemetry (which model, how long). */
  telemetry?: Array<{ role: CadRole; model?: string; ms: number }>;
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

/** Prompt for the plan step — request a short design plan (no code). */
function buildPlanPrompt(input: HarnessInput): string {
  const knowledge = buildKnowledgeBlock({
    prompt: input.prompt,
    process: input.process,
  });
  return `Plan a parametric 3D model for this request: ${input.prompt}\n\nDesign guidance to honor:\n\n${knowledge}`;
}

function buildUserPrompt(input: HarnessInput, plan?: string): string {
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

  if (plan) {
    out += `\n\nFollow this plan:\n${plan}`;
  }

  // Fold the owner's feedback on the prior version into the revise prompt so
  // the model actually corrects what was flagged (CON-181).
  const fb = input.priorFeedback;
  if (fb) {
    const tagLabels = (fb.tags ?? [])
      .map((t) => CAD_FEEDBACK_TAG_LABELS[t as CadFeedbackTag] ?? t)
      .filter(Boolean);
    const note = fb.note?.trim();
    if (fb.rating === "bad" || tagLabels.length > 0 || note) {
      const lines = ["The previous version received this feedback — fix it:"];
      if (tagLabels.length > 0) lines.push(`- Problems: ${tagLabels.join(", ")}`);
      if (note) lines.push(`- Note: ${note}`);
      out += `\n\n${lines.join("\n")}`;
    }
  }

  // On a fresh build, show the best-matching verified exemplar as a style
  // reference. (Revisions already have the prior code as their reference.)
  // The exemplars are sidecar-verified (scripts/verify-exemplars.ts), so this
  // now injects a matching example when one scores > 0 for the prompt.
  if (!input.priorSourceCode) {
    const exemplars = formatExemplars(selectExemplars(input.prompt));
    if (exemplars) out += `\n\n${exemplars}`;
  }

  return out;
}

/**
 * Targeted repair guidance for known, recurring failure classes — a generic
 * "fix it" lets the model retry the same mistake. Returns "" for unknown errors.
 */
function repairHintFor(note: string): string {
  const n = note.toLowerCase();
  if (/(fillet|chamfer)/.test(n) && /(smaller|max_fillet|radius|length|valid)/.test(n)) {
    return "That fillet/chamfer radius is too large for the geometry. REDUCE it substantially (at least halve it, and keep it well under the thinnest adjacent wall), apply it to fewer/specific edges, or wrap it in try/except and fall back to max_fillet() — do NOT retry the same radius.";
  }
  if (/rectanglerounded/.test(n) && /buildsketch/.test(n)) {
    return "RectangleRounded is a sketch primitive — use it INSIDE `with BuildSketch(...)` then extrude, not as a BuildPart operation.";
  }
  if (/slot/.test(n) && /width|height/.test(n)) {
    return "Slot/SlotOverall require width > height. Swap the dimensions and rotate the sketch 90°, or build the slot from a Rectangle + two Circles instead.";
  }
  return "";
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

  const telemetry: NonNullable<HarnessResult["telemetry"]> = [];
  const timed = async <T>(
    role: CadRole,
    model: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      telemetry.push({ role, model, ms: Date.now() - t });
    }
  };

  // Plan-then-code: a short design plan up front (fresh builds only — revisions
  // already have the prior code as their plan). Best-effort: a planning failure
  // must not block generation. No-op without model credentials.
  let plan: string | undefined;
  if (useModel && !input.priorSourceCode && planStepEnabled()) {
    const planModel = modelForRole("plan");
    try {
      const text = await timed("plan", planModel, () =>
        completeText({
          system: PLAN_SYSTEM_PROMPT,
          prompt: buildPlanPrompt(input),
          model: planModel,
          images: input.images ?? undefined,
          signal: input.signal,
        })
      );
      plan = text.trim() || undefined;
    } catch {
      plan = undefined;
    }
  }

  let lastCode = "";
  let lastRun: CadRunResult | undefined;
  let repairNote = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal?.aborted) break;

    emit({ type: "phase", phase: "generating", attempt, maxAttempts });
    if (useModel) {
      // Route the generate step by role: implement on the first pass, repair
      // thereafter. Both default to the strong model until configured.
      const role: CadRole = repairNote ? "repair" : "implement";
      const model = modelForRole(role);
      // On a repair turn, show the model a render of its OWN previous attempt
      // (when one exists) — text errors alone leave it blind to the actual
      // form. A render only exists once the run produced a valid solid, so
      // this kicks in mainly for "printable but visually weak" repairs.
      const priorRender = repairNote ? lastRun?.renderPng : undefined;
      const userPrompt = repairNote
        ? [
            buildUserPrompt(input, plan),
            "",
            `The previous attempt failed because ${repairNote}. Here is that code:`,
            "```python",
            lastCode,
            "```",
            repairHintFor(repairNote),
            priorRender
              ? "A render of that previous attempt is attached — use it to see what is actually wrong with the form, then fix it."
              : "",
            "Fix it.",
          ]
            .filter(Boolean)
            .join("\n")
        : buildUserPrompt(input, plan);
      const images: PromptImage[] = [
        ...(input.images ?? []),
        ...(priorRender
          ? [{ data: priorRender, mediaType: "image/png" as const }]
          : []),
      ];
      const text = await timed(role, model, () =>
        completeText({
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          model,
          images: images.length ? images : undefined,
          signal: input.signal,
        })
      );
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
        telemetry,
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
    telemetry,
  };
}
