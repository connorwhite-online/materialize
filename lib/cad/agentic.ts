import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { hasModelCredentials } from "./model-client";
import { SYSTEM_PROMPT, gradeRun } from "./prompt";
import { buildKnowledgeBlock } from "./knowledge";
import { selectExemplars, formatExemplars } from "./knowledge/exemplars";
import { judgeAesthetics, type AestheticJudgement } from "./critique";
import { CAD_FEEDBACK_TAG_LABELS, type CadFeedbackTag } from "./feedback";
import { modelForRole } from "./models";
import {
  createSession,
  deleteSession,
  execInSession,
  execProducedRun,
  rollbackSession,
  snapshotSession,
  CadSessionError,
} from "./session-client";
import type { HarnessInput, HarnessResult } from "./harness";
import type { CadProgressEvent, CadRunResult } from "./types";

/**
 * Agentic harness (docs/text-to-cad/03 §B): an Anthropic tool-use loop over a
 * stateful sidecar session, so a complex part is built INCREMENTALLY — base
 * form, then features, then shell, then fillets — with a per-step budget
 * instead of regenerate-everything retries. Same HarnessResult contract as
 * runHarness, so persistence and the route/worker don't change.
 *
 * Failure discipline: code that fails inside an exec is a normal tool result
 * (the agent repairs it); anything infrastructural — session transport, model
 * API — throws CadAgenticError so the orchestrator falls back to runHarness.
 */

// Tool-turn cap: each turn = one model call + its tool executions. Complex
// parts per doc 03 need >4 execs; 16 bounds cost without strangling them.
const MAX_TOOL_TURNS = 16;
const DEFAULT_MAX_MS = 240_000;
// Same default + headroom rationale as model-client.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
// Keep tool results promptable — stdout beyond this is noise, not signal.
const STDOUT_CAP = 2_000;

/** Infrastructure failure in the agentic loop — the orchestrator's cue to fall back. */
export class CadAgenticError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CadAgenticError";
  }
}

// Deliberately NOT model-client's completeText: the loop needs tools + full
// message history, which the one-shot wrapper intentionally doesn't expose.
// Same credential resolution + SDK patterns (see model-client.ts / CON-174).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    _client = apiKey
      ? new Anthropic({ apiKey })
      : new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN });
  }
  return _client;
}

async function completeWithTools(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  model?: string;
  signal?: AbortSignal;
}): Promise<Anthropic.Message> {
  if (!hasModelCredentials()) {
    throw new Error(
      "No model credentials (set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)"
    );
  }
  return getClient().messages.create(
    {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
    },
    { signal: opts.signal }
  );
}

const NO_INPUT = {
  type: "object" as const,
  properties: {},
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "exec",
    description:
      "Execute Python in the persistent CAD session (build123d + sdf_kit warmed; variables survive between calls). When the code assigns/updates `result` (or `parts`), the response includes validation flags, geometry stats, and a render.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "Python to exec in the session namespace." },
      },
      required: ["code"],
    },
  },
  {
    name: "render",
    description: "Re-return the renders from the last exec that produced a solid.",
    input_schema: NO_INPUT,
  },
  {
    name: "measure",
    description:
      "Geometry stats of the last produced solid: bounding box (mm), volume, triangle count.",
    input_schema: NO_INPUT,
  },
  {
    name: "grade",
    description:
      "Grade the last produced solid: validity (watertight/manifold/solid) plus the aesthetic judge when enabled. Use before finish().",
    input_schema: NO_INPUT,
  },
  {
    name: "snapshot",
    description:
      "Checkpoint the current session `result` so a failed risky step (large fillet, shell, boolean) can rollback() instead of restarting.",
    input_schema: NO_INPUT,
  },
  {
    name: "rollback",
    description: "Rewind the session `result` to the last snapshot.",
    input_schema: NO_INPUT,
  },
  {
    name: "finish",
    description:
      "Declare the model done. The last exec'd `result` becomes the returned part — make sure the final exec assigned it and it graded clean.",
    input_schema: NO_INPUT,
  },
];

const LOOP_GUIDANCE = `You are working in a PERSISTENT Python session via tools — build the part INCREMENTALLY, do not write one giant script:
- Order of work: base form first, then features (holes, bosses, cutouts), then shell/hollow, then fillets/chamfers last.
- Validate each meaningful step: exec it, check the validation flags and render before moving on.
- When a step fails, fix THAT step — the previous steps are still in the namespace; do not restart from scratch.
- snapshot() before risky operations (large fillets, shells, big booleans); rollback() if the step wrecks the solid.
- Keep each exec small and per-step; assign the running solid to \`result\` whenever a printable state exists so progress is never lost.
- You have a bounded budget (tool turns + wall clock). Get to a valid \`result\` early, then refine; call grade() and then finish() when it grades clean.`;

function buildSystemPrompt(input: HarnessInput): string {
  const knowledge = buildKnowledgeBlock({
    prompt: input.prompt,
    process: input.process,
  });
  const exemplars = formatExemplars(selectExemplars(input.prompt));
  return [SYSTEM_PROMPT, knowledge, exemplars, LOOP_GUIDANCE]
    .filter(Boolean)
    .join("\n\n");
}

function buildTaskPrompt(input: HarnessInput): string {
  const lines: string[] = [];
  if (input.priorSourceCode) {
    lines.push(
      "Revise the following model per this instruction, rebuilding it step by step in the session:",
      `Instruction: ${input.prompt}`,
      "",
      "Current code:",
      "```python",
      input.priorSourceCode,
      "```"
    );
  } else {
    lines.push(`Create a 3D model: ${input.prompt}`);
  }
  if (input.priorBrief != null) {
    lines.push("", `Design brief from the original build (honor its numbers): ${JSON.stringify(input.priorBrief)}`);
  }
  const fb = input.priorFeedback;
  if (fb) {
    const tagLabels = (fb.tags ?? [])
      .map((t) => CAD_FEEDBACK_TAG_LABELS[t as CadFeedbackTag] ?? t)
      .filter(Boolean);
    const note = fb.note?.trim();
    if (fb.rating === "bad" || tagLabels.length > 0 || note) {
      lines.push("", "The previous version received this feedback — fix it:");
      if (tagLabels.length > 0) lines.push(`- Problems: ${tagLabels.join(", ")}`);
      if (note) lines.push(`- Note: ${note}`);
    }
  }
  return lines.join("\n");
}

type ToolResultContent = Extract<
  Anthropic.ToolResultBlockParam["content"],
  unknown[]
>;

function textBlock(text: string): ToolResultContent[number] {
  return { type: "text", text };
}

function imageBlock(pngBase64: string): ToolResultContent[number] {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: pngBase64 },
  };
}

/**
 * Strip image blocks from all tool_result turns except the last two user
 * turns, replacing them with a re-fetch pointer. Mutates in place — the
 * first user turn (the task, possibly with reference images) is never touched.
 */
function pruneStaleImages(messages: Anthropic.MessageParam[]): void {
  const userTurnIdxs = messages
    .map((m, i) => (i > 0 && m.role === "user" ? i : -1))
    .filter((i) => i >= 0);
  for (const idx of userTurnIdxs.slice(0, -2)) {
    const content = messages[idx].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
      block.content = block.content.map((c) =>
        c.type === "image"
          ? { type: "text" as const, text: "[render omitted — call render() to re-fetch]" }
          : c
      );
    }
  }
}

/** Compact, promptable summary of a run — files omitted (huge base64). */
function runSummary(run: CadRunResult, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    ok: run.ok,
    validation: run.validation,
    geometry: run.geometry,
    remeshed: run.remeshed,
    error: run.error,
    ...extra,
  });
}

export async function runAgenticHarness(
  input: HarnessInput
): Promise<HarnessResult> {
  const maxMs = Number(process.env.CAD_AGENTIC_MAX_MS) || DEFAULT_MAX_MS;
  const model = modelForRole("implement");
  const startedAt = Date.now();

  const emit = (event: CadProgressEvent) => {
    try {
      input.onProgress?.(event);
    } catch {
      /* progress is cosmetic */
    }
  };

  const telemetry: NonNullable<HarnessResult["telemetry"]> = [];

  let sessionId: string | null = null;
  // Running source assembly: the exec history, step-marked, so the persisted
  // sourceCode approximates how the part was actually built (flywheel data).
  const steps: string[] = [];
  let lastRun: CadRunResult | undefined;
  // Most recent run that graded pass — the result we fall back to on budget
  // exhaustion or a model stop without finish().
  let bestRun: CadRunResult | undefined;
  let bestCode = "";
  let judgement: AestheticJudgement | null = null;
  let judgedBest = false;
  let toolTurns = 0;
  let execCount = 0;
  let finished = false;

  const assembled = () =>
    steps.length > 0 ? steps.join("\n\n") : `# agentic session for: ${input.prompt}`;

  try {
    sessionId = await createSession({ signal: input.signal });

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: buildTaskPrompt(input) },
          ...(input.images ?? []).map(
            (img): Anthropic.ContentBlockParam => ({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType,
                data: img.data,
              },
            })
          ),
        ],
      },
    ];
    const system = buildSystemPrompt(input);

    while (toolTurns < MAX_TOOL_TURNS && !finished) {
      if (input.signal?.aborted) break;
      if (Date.now() - startedAt > maxMs) break;
      toolTurns++;

      emit({
        type: "phase",
        phase: "generating",
        attempt: toolTurns,
        maxAttempts: MAX_TOOL_TURNS,
      });
      // Renders of superseded intermediate solids carry no signal but their
      // base64 re-uploads on EVERY subsequent call — O(turns²) image cost
      // left unpruned. Keep images only in the last two tool-result turns;
      // the render tool re-fetches on demand.
      pruneStaleImages(messages);

      const t = Date.now();
      let message: Anthropic.Message;
      try {
        message = await completeWithTools({
          system,
          messages,
          tools: TOOLS,
          model,
          signal: input.signal,
        });
      } finally {
        telemetry.push({ role: "implement", model, ms: Date.now() - t });
      }

      messages.push({ role: "assistant", content: message.content });
      const toolUses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      // The model stopped talking instead of calling finish() — accept the
      // best state it reached rather than prompting it in circles.
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const content = await runTool(use);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content,
        });
        if (finished) break;
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    if (err instanceof CadAgenticError) throw err;
    throw new CadAgenticError(
      `agentic harness failed: ${(err as Error)?.message ?? err}`,
      { cause: err }
    );
  } finally {
    if (sessionId) {
      // Best-effort, and never with the (possibly aborted) request signal.
      await deleteSession(sessionId).catch(() => undefined);
    }
  }

  // Grade/judge the accepted run once when the agent didn't already — keeps
  // aestheticScore populated for the flywheel exactly like runHarness.
  if (bestRun && !judgedBest) {
    judgement = await judgeAesthetics({
      renderPng: bestRun.renderPng,
      renders: bestRun.renders,
      prompt: input.prompt,
      signal: input.signal,
    });
  }

  const run = bestRun ?? lastRun;
  const ok = !!bestRun;
  return {
    ok,
    sourceCode: ok && bestCode ? bestCode : assembled(),
    attempts: execCount,
    run,
    aestheticScore: judgement?.available ? (judgement.score ?? null) : null,
    aestheticDims: judgement?.available ? (judgement.perDimension ?? null) : null,
    brief: input.priorBrief,
    telemetry,
    error: ok
      ? undefined
      : lastRun
        ? gradeRun(lastRun).failures.join("; ") || "no valid result"
        : "the agent produced no runnable result",
  };

  /** Dispatch one tool call; returns the tool_result content blocks. */
  async function runTool(
    use: Anthropic.ToolUseBlock
  ): Promise<ToolResultContent> {
    switch (use.name) {
      case "exec": {
        const code = String((use.input as { code?: unknown })?.code ?? "");
        if (!code.trim()) return [textBlock("exec called with empty code")];
        emit({
          type: "phase",
          phase: "executing",
          attempt: toolTurns,
          maxAttempts: MAX_TOOL_TURNS,
        });
        execCount++;
        const res = await execInSession(sessionId!, code, {
          formats: ["stl", "step"],
          signal: input.signal,
        });
        steps.push(`# ---- step ${execCount} ----\n${code}`);
        const stdout =
          res.stdout.length > STDOUT_CAP
            ? `${res.stdout.slice(0, STDOUT_CAP)}\n…(truncated)`
            : res.stdout;
        if (!execProducedRun(res)) {
          return [
            textBlock(
              JSON.stringify({ ok: true, stdout, namespace: res.namespace })
            ),
          ];
        }
        lastRun = res;
        const grade = gradeRun(res);
        if (grade.pass) {
          bestRun = res;
          bestCode = assembled();
          judgedBest = false;
        }
        const blocks: ToolResultContent = [
          textBlock(
            runSummary(res, {
              gradePass: grade.pass,
              gradeFailures: grade.failures,
              stdout,
              namespace: res.namespace,
            })
          ),
        ];
        // Auto-attach the render whenever the exec changed the solid (doc 03
        // open question 4's default) so the agent can't build blind.
        if (res.renderPng) blocks.push(imageBlock(res.renderPng));
        return blocks;
      }
      case "render": {
        if (!lastRun) return [textBlock("no solid produced yet — exec code that assigns `result` first")];
        const views = Object.entries(lastRun.renders ?? {}).filter(
          (e): e is [string, string] => typeof e[1] === "string"
        );
        if (views.length === 0 && !lastRun.renderPng) {
          return [textBlock("the last run produced no render")];
        }
        const blocks: ToolResultContent = [];
        if (views.length > 0) {
          blocks.push(textBlock(`views: ${views.map(([k]) => k).join(", ")}`));
          for (const [, png] of views) blocks.push(imageBlock(png));
        } else {
          blocks.push(textBlock("views: threeQuarter"));
          blocks.push(imageBlock(lastRun.renderPng!));
        }
        return blocks;
      }
      case "measure": {
        if (!lastRun?.geometry) {
          return [textBlock("no geometry yet — exec code that assigns `result` first")];
        }
        return [textBlock(JSON.stringify(lastRun.geometry))];
      }
      case "grade": {
        if (!lastRun) return [textBlock("nothing to grade — exec code that assigns `result` first")];
        const grade = gradeRun(lastRun);
        if (!grade.pass) {
          emit({
            type: "validation",
            attempt: toolTurns,
            maxAttempts: MAX_TOOL_TURNS,
            pass: false,
            failures: grade.failures,
            validation: lastRun.validation,
          });
        }
        judgement = await judgeAesthetics({
          renderPng: lastRun.renderPng,
          renders: lastRun.renders,
          prompt: input.prompt,
          signal: input.signal,
        });
        if (lastRun === bestRun) judgedBest = true;
        return [
          textBlock(
            JSON.stringify({
              pass: grade.pass,
              failures: grade.failures,
              aesthetic: judgement.available
                ? {
                    score: judgement.score,
                    pass: judgement.pass,
                    feedback: judgement.feedback,
                  }
                : null,
            })
          ),
        ];
      }
      case "snapshot": {
        await snapshotSession(sessionId!, input.signal);
        return [textBlock("snapshot saved")];
      }
      case "rollback": {
        await rollbackSession(sessionId!, input.signal);
        steps.push("# ---- rolled back to the last snapshot ----");
        return [textBlock("rolled back to the last snapshot")];
      }
      case "finish": {
        finished = true;
        return [textBlock("finishing — the last `result` will be exported")];
      }
      default:
        return [textBlock(`unknown tool: ${use.name}`)];
    }
  }
}
