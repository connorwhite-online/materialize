import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadJobs } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { computeCostCents } from "@/lib/billing/cad-pricing";
import { recordGenerationDebit } from "@/lib/billing/cad-credits";
import { resolveModelCredentials } from "@/lib/cad/credentials";
import type { PriorFeedback } from "@/lib/cad/harness";
import type { CadProcess } from "@/lib/cad/knowledge/dfm";
import { CadMeter, runWithCadContext } from "@/lib/cad/metering";
import { runCadGeneration } from "@/lib/cad/orchestrate";
import type { PromptImage } from "@/lib/cad/model-client";
import {
  persistGenerationFailure,
  persistGenerationSuccess,
} from "@/lib/cad/persist";
import type {
  CadDoneEvent,
  CadJobProgressEntry,
  CadQuestion,
} from "@/lib/cad/types";
import { resolveStoredAnswer } from "@/lib/cad/types";

/**
 * Background-job execution for text-to-CAD generation (MTR-175,
 * docs/text-to-cad/02 §A/§B). The cadJobs row is the source of truth:
 *
 *   POST /api/cad/generate            inserts the row + schedules
 *                                     executeCadJob via after()
 *   GET  /api/cad/jobs/[id]/events    replays + tails `progress` over SSE
 *   POST /api/cad/jobs/[id]/cancel    sets cancelRequestedAt; the poll in
 *                                     executeCadJob turns it into an abort
 *
 * Client disconnects never cancel anything — cancellation is explicit.
 * Today executeCadJob runs in-process (inside the generate route's
 * function lifetime on Vercel); the Railway-worker upgrade swaps WHERE it
 * runs, not its contract — a queue consumer calls it with the same
 * arguments and the job/events/cancel surfaces stay identical.
 */

/**
 * Cap on persisted progress entries: when the array outgrows this, the
 * middle is dropped and the first/last halves kept (the setup story and
 * the current state + terminal record are what replays care about;
 * per-attempt spam in long repair loops is not).
 */
export const MAX_PROGRESS_EVENTS = 200;
/** How often executeCadJob checks cancelRequestedAt. */
const CANCEL_POLL_MS = 3_000;
/** Progress writes are batched; flush at most this often (terminal always flushes). */
const FLUSH_INTERVAL_MS = 750;
/** How often the awaiting_input wait polls cadJobs.answers for a pick (MTR-191). */
const ANSWER_POLL_MS = 1_500;
/** Default seconds to wait on a question before proceeding with its default. */
const DEFAULT_QUESTION_TIMEOUT_S = 120;
/** Ceiling on a question's wait — an away user still gets a part (MTR-191). */
const MAX_QUESTION_TIMEOUT_S = 600;

/**
 * How many mid-cycle questions a single generation may pause for (MTR-191).
 * Default 1 — one focused question is the product intent; env-tunable. 0
 * disables interactive questions entirely (the asker resolves to the default
 * without ever suspending), a safe kill switch.
 */
export function maxQuestionsPerJob(): number {
  const n = Number(process.env.CAD_MAX_QUESTIONS_PER_JOB);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
}

/** Insert a queued job row for a generation and return its id. */
export async function createCadJob(
  generationId: string
): Promise<{ jobId: string }> {
  const [row] = await db
    .insert(cadJobs)
    .values({ generationId, status: "queued" })
    .returning({ id: cadJobs.id });
  return { jobId: row.id };
}

/**
 * Append one or more entries to the job's progress log, enforcing the
 * MAX_PROGRESS_EVENTS cap (drop middle, keep first/last).
 *
 * Read-modify-write on purpose, and deliberately NOT withDbRetry: this is
 * a write path (withDbRetry is read-only by contract), and the executing
 * job is the row's only progress writer, so there is no concurrent-append
 * race to defend against.
 */
export async function appendJobProgress(
  jobId: string,
  event: CadJobProgressEntry | CadJobProgressEntry[]
): Promise<void> {
  const incoming = Array.isArray(event) ? event : [event];
  if (incoming.length === 0) return;

  const [row] = await db
    .select({ progress: cadJobs.progress })
    .from(cadJobs)
    .where(eq(cadJobs.id, jobId))
    .limit(1);
  if (!row) return;

  let next = [...(row.progress ?? []), ...incoming];
  if (next.length > MAX_PROGRESS_EVENTS) {
    const head = Math.floor(MAX_PROGRESS_EVENTS / 2);
    const tail = MAX_PROGRESS_EVENTS - head;
    next = [...next.slice(0, head), ...next.slice(next.length - tail)];
  }

  await db
    .update(cadJobs)
    .set({ progress: next })
    .where(eq(cadJobs.id, jobId));
}

export interface ExecuteCadJobInput {
  jobId: string;
  generationId: string;
  userId: string;
  prompt: string;
  parentGenerationId?: string | null;
  /** Thread name a revision inherits (client-supplied, as before). */
  name?: string;
  images?: PromptImage[];
  /**
   * Target CraftCloud process (MTR-171). Threads into the harness so DFM
   * guidance is process-specific instead of the conservative envelope, and is
   * stamped onto the generation's config fingerprint. Null/absent = unset.
   */
  process?: CadProcess | null;
  /**
   * Parent source/feedback for a revision. Loaded — with the ownership
   * check — in the generate route BEFORE the job row exists, so an
   * unauthorized request never mints a generation or a job.
   */
  priorSourceCode?: string | null;
  priorFeedback?: PriorFeedback | null;
  /** Parent's persisted design brief (jsonb) — revisions inherit + patch it. */
  priorBrief?: unknown;
  /** User-reviewed brief from the studio's brief card (fresh builds only). */
  providedBrief?: unknown;
}

/**
 * Run one generation job to completion: mark running, execute the same
 * generative-vs-harness routing the old in-request stream ran, persist
 * the outcome, and record every progress event (batched) plus a terminal
 * `done`/`error` entry in cadJobs.progress for the events route to replay.
 *
 * Cancellation is cooperative: a poll watches cancelRequestedAt and aborts
 * the AbortSignal the harness/sidecar calls run under.
 *
 * Never throws for expected failures — the job row (and the generation
 * row via persistGenerationFailure) carries the error instead.
 */
export async function executeCadJob(input: ExecuteCadJobInput): Promise<void> {
  const { jobId, generationId, userId, prompt } = input;
  const isRoot = !input.parentGenerationId;
  const images = input.images?.length ? input.images : undefined;

  const controller = new AbortController();
  let cancelRequested = false;

  // --- Batched progress writes -------------------------------------------
  // Events are buffered and flushed at most every FLUSH_INTERVAL_MS so a
  // chatty harness doesn't turn into a DB write per event. Writes chain so
  // batches land in order; the terminal record always flushes (awaited).
  const buffer: CadJobProgressEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = 0;
  let writeChain: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (buffer.length === 0) return writeChain;
    const batch = buffer.splice(0);
    writeChain = writeChain
      .then(() => appendJobProgress(jobId, batch))
      .catch((err) => logError("executeCadJob.progress", err));
    return writeChain;
  };
  // Live previews bypass the append-only progress log (SSE cursor + size):
  // latest render only, in a dedicated column the events route polls.
  let snapshotChain: Promise<void> = Promise.resolve();
  const writeSnapshot = (render: string, step: number) => {
    snapshotChain = snapshotChain.then(() =>
      db
        .update(cadJobs)
        .set({ lastSnapshot: render, snapshotStep: step, updatedAt: new Date() })
        .where(eq(cadJobs.id, jobId))
        .then(
          () => undefined,
          () => undefined // best-effort — a lost preview is cosmetic
        )
    );
  };

  const onProgress = (event: CadJobProgressEntry) => {
    if (event.type === "snapshot") {
      writeSnapshot(event.render, event.step);
      return;
    }
    buffer.push(event);
    const elapsed = Date.now() - lastFlush;
    if (elapsed >= FLUSH_INTERVAL_MS) {
      lastFlush = Date.now();
      void flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        lastFlush = Date.now();
        void flush();
      }, FLUSH_INTERVAL_MS - elapsed);
    }
  };
  /** Append the terminal record and wait until every buffered write landed. */
  const flushTerminal = async (event: CadJobProgressEntry): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    buffer.push(event);
    await flush();
  };

  const markJob = (patch: Partial<typeof cadJobs.$inferInsert>) =>
    db.update(cadJobs).set(patch).where(eq(cadJobs.id, jobId));

  // --- Interactive questions (MTR-191) -----------------------------------
  // The harness can SUSPEND a running build to ask one multiple-choice
  // question and RESUME with the answer. Reuses the cancellation model
  // exactly: emit the question, flip to `awaiting_input`, poll cadJobs.answers
  // (the answer endpoint is the row's only answer-writer) until the pick lands
  // — or the timeout elapses and we proceed with the default so an away user
  // still gets a part. Never suspends past the per-job budget, and never once
  // cancellation is in flight (a terminal state must not be blocked).
  const questionBudget = maxQuestionsPerJob();
  let questionsAsked = 0;
  const onQuestion = async (q: CadQuestion): Promise<string> => {
    const fallback = q.defaultOptionId ?? q.options[0]?.id ?? "";
    if (
      q.options.length === 0 ||
      questionsAsked >= questionBudget ||
      cancelRequested ||
      controller.signal.aborted
    ) {
      return fallback;
    }
    questionsAsked++;

    const timeoutS = Math.min(
      Math.max(1, Math.round(q.timeoutS ?? DEFAULT_QUESTION_TIMEOUT_S)),
      MAX_QUESTION_TIMEOUT_S
    );
    // Emit + suspend. Flush immediately (don't wait on the batch timer) so the
    // studio shows the card fast, then flip the row to awaiting_input.
    buffer.push({
      type: "question",
      questionId: q.id,
      text: q.text,
      options: q.options,
      defaultOptionId: q.defaultOptionId,
      timeoutS,
    });
    await flush();
    await markJob({ status: "awaiting_input", updatedAt: new Date() }).catch(
      (err) => logError("executeCadJob.ask", err)
    );

    const deadline = Date.now() + timeoutS * 1000;
    let chosen: string | null = null;
    let viaDefault = false;
    while (Date.now() < deadline) {
      if (cancelRequested || controller.signal.aborted) {
        chosen = fallback;
        viaDefault = true;
        break;
      }
      try {
        const [row] = await db
          .select({ answers: cadJobs.answers })
          .from(cadJobs)
          .where(eq(cadJobs.id, jobId))
          .limit(1);
        const pick = row?.answers?.[q.id];
        if (typeof pick === "string" && pick) {
          // Honor a preset pick OR a free-text custom answer (MTR-216); only a
          // value that resolves to neither — a stale option id after the
          // question changed, schema drift — falls back to the default.
          const resolved = resolveStoredAnswer(pick, q.options);
          chosen = resolved ? pick : fallback;
          viaDefault = resolved == null;
          break;
        }
      } catch {
        // Transient read failure — retry next tick.
      }
      await new Promise((r) => setTimeout(r, ANSWER_POLL_MS));
    }
    if (chosen == null) {
      chosen = fallback;
      viaDefault = true;
    }

    // Human-readable label for the thread: the option's label for a preset, the
    // typed text for a custom answer (MTR-216), never the raw sentinel.
    const resolvedChosen = resolveStoredAnswer(chosen, q.options);
    const label =
      resolvedChosen?.kind === "option"
        ? resolvedChosen.option.label
        : resolvedChosen?.kind === "text"
          ? resolvedChosen.text
          : chosen;
    // Resume: record the resolution (visible in thread history + replay) and
    // flip back to running BEFORE returning, so the harness continues under a
    // running job.
    buffer.push({
      type: "answer",
      questionId: q.id,
      optionId: chosen,
      label,
      viaDefault,
    });
    await flush();
    if (!cancelRequested && !controller.signal.aborted) {
      await markJob({ status: "running", updatedAt: new Date() }).catch((err) =>
        logError("executeCadJob.resume", err)
      );
    }
    return chosen;
  };

  // --- Cost metering (MTR-181) -------------------------------------------
  // One meter per job, active for everything runCadGeneration does (model
  // calls, sidecar runs, fal invocations record into it via the async
  // context). The RAW summary + a cents rollup at current CAD_PRICE_* unit
  // prices land on the job row with EVERY terminal status — failures and
  // cancellations cost real money too, only the (flag-gated) credit debit
  // is success-only. `route` is stamped once the router verdict is known.
  const meter = new CadMeter();
  let meteredRoute: string | undefined;
  const usagePatch = () => {
    const usage = meter.summarize(meteredRoute);
    return { usage, costCents: computeCostCents(usage) };
  };

  // The terminal progress record is always written BEFORE the terminal
  // status flip — the events route relies on that ordering to close with
  // the terminal frame already replayed.
  const finishCancelled = async () => {
    await persistGenerationFailure(generationId, "Generation cancelled.").catch(
      () => undefined
    );
    await flushTerminal({
      type: "error",
      error: "Generation cancelled.",
      generationId,
    });
    await markJob({
      status: "cancelled",
      finishedAt: new Date(),
      ...usagePatch(),
    });
  };
  const finishFailed = async (message: string) => {
    await flushTerminal({ type: "error", error: message, generationId });
    await markJob({
      status: "failed",
      error: message,
      finishedAt: new Date(),
      ...usagePatch(),
    });
  };

  try {
    // Cancelled before it ever started (cancel raced the after() handoff).
    const [pre] = await db
      .select({ cancelRequestedAt: cadJobs.cancelRequestedAt })
      .from(cadJobs)
      .where(eq(cadJobs.id, jobId))
      .limit(1);
    if (pre?.cancelRequestedAt) {
      await finishCancelled();
      return;
    }

    await markJob({ status: "running", startedAt: new Date() });
  } catch (error) {
    logError("executeCadJob.start", error);
    return;
  }

  // Cooperative cancellation: poll cancelRequestedAt and abort the signal
  // the harness/sidecar/model calls run under. A client disconnect no
  // longer aborts anything — this flag (set by the cancel endpoint) is the
  // only trigger.
  const cancelPoll = setInterval(() => {
    void (async () => {
      try {
        const [row] = await db
          .select({ cancelRequestedAt: cadJobs.cancelRequestedAt })
          .from(cadJobs)
          .where(eq(cadJobs.id, jobId))
          .limit(1);
        if (row?.cancelRequestedAt && !cancelRequested) {
          cancelRequested = true;
          controller.abort();
        }
      } catch {
        // Best-effort — a failed poll just delays cancellation one tick.
      }
    })();
  }, CANCEL_POLL_MS);

  try {
    // BYOK seam (MTR-181): resolve which credentials this generation's
    // model calls run under. With CAD_BYOK_ENABLED off (default) this is
    // the platform env credentials and completeText keeps its singleton —
    // byte-identical. Best-effort: a resolution hiccup means platform.
    const credentials = await resolveModelCredentials(userId).catch(
      () => undefined
    );

    // Complexity-routed entry (docs/text-to-cad/03 §C): simple prompts keep
    // the scripted loop, complex ones get the agentic session loop, organic
    // ones the generative backend. With CAD_AGENTIC=false / no sessions /
    // no credentials this is byte-identical to the old inline routing.
    // runWithCadContext scopes the cost meter + credentials to this run.
    const result = await runWithCadContext({ meter, credentials }, () =>
      runCadGeneration({
        prompt,
        priorSourceCode: input.priorSourceCode ?? null,
        priorFeedback: input.priorFeedback ?? null,
        priorBrief: input.priorBrief,
        providedBrief: input.providedBrief,
        process: input.process ?? null,
        images,
        signal: controller.signal,
        onProgress,
        onQuestion,
      })
    );
    meteredRoute = result.route;

    // runGenerative swallows AbortError into { ok: false }; catch the
    // cancel case here so it lands as `cancelled`, not `failed`.
    if (cancelRequested) {
      await finishCancelled();
      return;
    }

    if (!result.ok || !result.run) {
      const failed = await persistGenerationFailure(
        generationId,
        result.error ?? "Could not produce a valid model.",
        result.sourceCode,
        result.attempts
      );
      await finishFailed(failed.error);
      return;
    }

    const persisted = await persistGenerationSuccess({
      userId,
      generationId,
      prompt,
      isRoot,
      // Revisions inherit the thread's current name from the client.
      nameOverride: input.name,
      // Stamped onto the config fingerprint for outcome slicing (MTR-171).
      process: input.process ?? null,
      result,
    });

    if ("error" in persisted) {
      await finishFailed(persisted.error);
      return;
    }

    // Terminal record INTO progress — the same CadDoneEvent shape the old
    // SSE route sent, so the events route replays a finished job verbatim.
    const done: CadDoneEvent = {
      type: "done",
      generationId: persisted.generationId,
      fileAssetId: persisted.fileAssetId,
      fileSlug: persisted.fileSlug,
      renderUrl: persisted.renderUrl,
      sourceCode: persisted.sourceCode,
      title: persisted.title,
      parts: persisted.parts,
      projectSlug: persisted.projectSlug,
      remeshed: persisted.remeshed,
      // STEP availability rides along so the studio's action row is stable at
      // first paint (no post-mount "Download STEP" pop-in, MTR-215).
      hasStep: persisted.hasStep,
    };
    await flushTerminal(done);
    await markJob({ status: "done", finishedAt: new Date(), ...usagePatch() });

    // Credit debit (MTR-181): success-only, flag-gated (CAD_CREDITS_ENABLED,
    // default off → hard no-op), priced per route tier (CAD_CREDIT_COST_*,
    // default 0 → still a no-op), idempotent per job, and never throws —
    // bookkeeping must not fail a finished generation.
    await recordGenerationDebit({
      userId,
      jobId,
      generationId,
      route: result.route,
    });
  } catch (error) {
    if (cancelRequested || (error as Error)?.name === "AbortError") {
      await finishCancelled().catch((err) =>
        logError("executeCadJob.cancel", err)
      );
    } else {
      logError("executeCadJob", error);
      await persistGenerationFailure(
        generationId,
        "Generation failed. Please try again."
      ).catch(() => undefined);
      await finishFailed("Generation failed. Please try again.").catch((err) =>
        logError("executeCadJob.fail", err)
      );
    }
  } finally {
    clearInterval(cancelPoll);
    if (flushTimer) clearTimeout(flushTimer);
  }
}
