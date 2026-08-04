import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { cadGenerations, cadJobs } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { persistGenerationFailure } from "@/lib/cad/persist";
import type { CadJobProgressEntry } from "@/lib/cad/types";
import { logError } from "@/lib/logger";

/**
 * SSE progress stream for a background CAD generation job (MTR-175).
 *
 * Replays every persisted entry from cadJobs.progress as `data:` frames,
 * then tails the row (1s poll) and emits new entries until the job reaches
 * a terminal status (done/failed/cancelled), closing after the terminal
 * record. The client can drop and reconnect freely — the replay makes the
 * stream resumable — and disconnecting does NOT cancel the job (that's the
 * explicit POST /api/cad/jobs/[jobId]/cancel). Per AGENTS.md, a long-lived
 * polling loop the client consumes directly belongs in a route, not behind
 * a server action.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
// Close politely before the platform kills the function; the studio's
// reconnect logic reattaches and the replay resumes where it left off.
const HARD_CEILING_MS = 290_000;
// A job whose executor died without writing a terminal status (platform kill
// past maxDuration, process crash) would otherwise tail forever as "running".
// Measured against the job's HEARTBEAT (updatedAt, bumped per progress
// append), not its age — so it must exceed only the longest legitimately
// SILENT stretch: one sidecar exec (up to 600s wall, CAD_RUN_TIMEOUT_S)
// plus the aesthetic judge, during which no progress events fire. 15min
// covers that with margin while closing dead tails reasonably fast.
const STALE_RUNNING_MS = 15 * 60_000;
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  props: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await props.params;
  const url = new URL(request.url);
  // Resumable replay cursor (CAD-8): the last seq the client already
  // applied, so a reconnect after a dropped connection (proxy timeout, the
  // route's own ~290s ceiling) doesn't re-send the whole transcript. Pairs
  // with the `seq` CAD-7 stamps on each persisted entry; -1 (or an absent /
  // malformed param) means "send everything" and matches the cold-start
  // default below.
  const fromParam = url.searchParams.get("from");
  const parsedFrom = fromParam === null ? NaN : Number(fromParam);
  const initialSeq = Number.isFinite(parsedFrom)
    ? Math.max(-1, Math.floor(parsedFrom))
    : -1;

  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    // Mirror the page's notFound() — don't reveal the feature exists.
    return new Response("Not found", { status: 404 });
  }

  // Reject non-UUIDs before they hit Postgres as a cast error.
  if (!UUID_RE.test(jobId)) return new Response("Not found", { status: 404 });

  // Ownership: the job belongs to whoever owns its generation. Read-only,
  // so withDbRetry is in-contract here.
  const [job] = await withDbRetry(() =>
    db
      .select({
        status: cadJobs.status,
        progress: cadJobs.progress,
        error: cadJobs.error,
        usage: cadJobs.usage,
        generationId: cadJobs.generationId,
        ownerId: cadGenerations.userId,
      })
      .from(cadJobs)
      .innerJoin(cadGenerations, eq(cadJobs.generationId, cadGenerations.id))
      .where(eq(cadJobs.id, jobId))
      .limit(1)
  );
  if (!job || job.ownerId !== userId) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true; // client gone
        }
      };
      const sendEvent = (event: CadJobProgressEntry) =>
        send(`data: ${JSON.stringify(event)}\n\n`);

      let status: string = job.status;
      let jobError = job.error;
      let entries: CadJobProgressEntry[] = job.progress ?? [];
      // seq-based cursor (CAD-7): a positional index desyncs permanently
      // once the array's length gets pinned at MAX_PROGRESS_EVENTS by the
      // drop-the-middle cap (appendJobProgress) — `sent === length` forever
      // after that, so nothing (not even the terminal frame) ever emits
      // again. `seq` is stamped once per entry at append time and survives
      // trimming, so comparing against it stays correct regardless of how
      // the array's length moves. Entries written before `seq` existed fall
      // back to their array index, matching appendJobProgress's own
      // fallback so old and new rows agree on ordering.
      let lastSeq = initialSeq;
      const emitNew = () => {
        for (let i = 0; i < entries.length; i++) {
          const s = entries[i].seq ?? i;
          if (s > lastSeq) {
            sendEvent(entries[i]);
            lastSeq = s;
          }
        }
      };

      // Replay everything persisted so far, then tail.
      emitNew();

      // Live cost meter: cadJobs.usage is flushed mid-run by the executor;
      // synthesize a `usage` frame whenever it changes (same pattern as the
      // snapshot column — kept OUT of the append-only progress log).
      let sentUsageJson = "";
      const emitUsage = (usage: unknown) => {
        if (!usage) return;
        const json = JSON.stringify(usage);
        if (json === sentUsageJson) return;
        sentUsageJson = json;
        send(`data: ${JSON.stringify({ type: "usage", usage })}\n\n`);
      };
      emitUsage(job.usage);

      const startedAt = Date.now();
      let lastBeat = Date.now();
      let sentSnapshotStep = 0;
      while (
        !TERMINAL_STATUSES.has(status) &&
        !closed &&
        !request.signal.aborted &&
        Date.now() - startedAt < HARD_CEILING_MS
      ) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        try {
          const [row] = await withDbRetry(() =>
            db
              .select({
                status: cadJobs.status,
                progress: cadJobs.progress,
                error: cadJobs.error,
                usage: cadJobs.usage,
                startedAt: cadJobs.startedAt,
                createdAt: cadJobs.createdAt,
                updatedAt: cadJobs.updatedAt,
                snapshotStep: cadJobs.snapshotStep,
              })
              .from(cadJobs)
              .where(eq(cadJobs.id, jobId))
              .limit(1)
          );
          if (row) {
            status = row.status;
            entries = row.progress ?? [];
            jobError = row.error;
            emitUsage(row.usage);
            // Live preview: the render lives in its own column (not the
            // append-only progress log); fetch it only when the step moved.
            if (row.snapshotStep > sentSnapshotStep) {
              sentSnapshotStep = row.snapshotStep;
              const [snap] = await db
                .select({
                  lastSnapshot: cadJobs.lastSnapshot,
                  lastSnapshotPoints: cadJobs.lastSnapshotPoints,
                })
                .from(cadJobs)
                .where(eq(cadJobs.id, jobId))
                .limit(1);
              if (snap?.lastSnapshot) {
                sendEvent({
                  type: "snapshot",
                  render: snap.lastSnapshot,
                  step: row.snapshotStep,
                  points: snap.lastSnapshotPoints ?? undefined,
                });
              }
            }
            // Reap-on-read: a running/queued job whose HEARTBEAT went stale
            // died without a terminal write — mark it failed so this tail
            // (and every future reattach) closes instead of polling a
            // corpse. The heartbeat is cadJobs.updatedAt, bumped on every
            // progress append (appendJobProgress) — age-since-start falsely
            // reaped long legitimate builds and let dead jobs linger for
            // the whole window. Plain write, not withDbRetry (write path).
            // `awaiting_input` (MTR-191) is deliberately EXCLUDED: it's a live
            // suspend on user input bounded by the question's own timeout, not
            // a dead job — reaping it would kill a legitimately-waiting build
            // (and the SQL guard below wouldn't match it anyway, desyncing the
            // local `status`).
            const lastBeat = row.updatedAt ?? row.startedAt ?? row.createdAt;
            if (
              (status === "running" || status === "queued") &&
              lastBeat &&
              Date.now() - lastBeat.getTime() > STALE_RUNNING_MS
            ) {
              jobError =
                "Generation was interrupted before finishing. Please try again.";
              const reaped = await db
                .update(cadJobs)
                .set({
                  status: "failed",
                  error: jobError,
                  finishedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(cadJobs.id, jobId),
                    inArray(cadJobs.status, ["queued", "running"])
                  )
                )
                .returning({ id: cadJobs.id });
              status = "failed";
              // Only when OUR update actually matched a row (the .returning()
              // guards a race where the job finished between the read above
              // and this write — reaping it now would clobber a legitimate
              // terminal status). Without this, cadGenerations.status stayed
              // "pending" forever: the cadJobs row went failed but nothing
              // ever told the generation, so the turn could never be
              // reattached or resolved (CAD-9).
              if (reaped.length > 0) {
                await persistGenerationFailure(job.generationId, jobError).catch(
                  (err) => logError("cad.events.reapPersistFailure", err)
                );
              }
            }
            emitNew();
          }
        } catch {
          // Transient read failure — keep tailing; the next poll retries.
        }
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          send(`: ping\n\n`); // SSE comment frame keeps proxies from idling out
          lastBeat = Date.now();
        }
      }

      // The executor writes the terminal record BEFORE flipping status, so
      // by the time status is terminal it was already emitted above. This
      // fallback covers a job that died without one (crash / platform kill)
      // so the client always gets a terminal frame before close.
      if (!closed && TERMINAL_STATUSES.has(status)) {
        const last = entries[entries.length - 1];
        const hasTerminal =
          !!last && (last.type === "done" || last.type === "error");
        if (!hasTerminal) {
          sendEvent({
            type: "error",
            error:
              status === "cancelled"
                ? "Generation cancelled."
                : jobError || "Generation failed. Please try again.",
            generationId: job.generationId,
          });
        }
      }

      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush as they happen.
      "X-Accel-Buffering": "no",
    },
  });
}
