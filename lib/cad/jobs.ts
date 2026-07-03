import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadJobs } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import type { PriorFeedback } from "@/lib/cad/harness";
import { runCadGeneration } from "@/lib/cad/orchestrate";
import type { PromptImage } from "@/lib/cad/model-client";
import {
  persistGenerationFailure,
  persistGenerationSuccess,
} from "@/lib/cad/persist";
import type { CadDoneEvent, CadJobProgressEntry } from "@/lib/cad/types";

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
    await markJob({ status: "cancelled", finishedAt: new Date() });
  };
  const finishFailed = async (message: string) => {
    await flushTerminal({ type: "error", error: message, generationId });
    await markJob({ status: "failed", error: message, finishedAt: new Date() });
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
    // Complexity-routed entry (docs/text-to-cad/03 §C): simple prompts keep
    // the scripted loop, complex ones get the agentic session loop, organic
    // ones the generative backend. With CAD_AGENTIC=false / no sessions /
    // no credentials this is byte-identical to the old inline routing.
    const result = await runCadGeneration({
      prompt,
      priorSourceCode: input.priorSourceCode ?? null,
      priorFeedback: input.priorFeedback ?? null,
      priorBrief: input.priorBrief,
      providedBrief: input.providedBrief,
      images,
      signal: controller.signal,
      onProgress,
    });

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
    };
    await flushTerminal(done);
    await markJob({ status: "done", finishedAt: new Date() });
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
