import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { cadGenerations, cadJobs } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import type { CadJobProgressEntry } from "@/lib/cad/types";

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
// Executions are bounded by the generate route's maxDuration=300s, so a
// running job older than this is provably dead — reap it on read.
const STALE_RUNNING_MS = 10 * 60_000;
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  props: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await props.params;

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
      let sent = 0;
      const emitNew = () => {
        // The array can only shrink when the executor's ~200-entry cap
        // dropped middle entries; resync instead of replaying from zero.
        if (entries.length < sent) sent = entries.length;
        for (; sent < entries.length; sent++) sendEvent(entries[sent]);
      };

      // Replay everything persisted so far, then tail.
      emitNew();

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
                startedAt: cadJobs.startedAt,
                createdAt: cadJobs.createdAt,
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
            // Live preview: the render lives in its own column (not the
            // append-only progress log); fetch it only when the step moved.
            if (row.snapshotStep > sentSnapshotStep) {
              sentSnapshotStep = row.snapshotStep;
              const [snap] = await db
                .select({ lastSnapshot: cadJobs.lastSnapshot })
                .from(cadJobs)
                .where(eq(cadJobs.id, jobId))
                .limit(1);
              if (snap?.lastSnapshot) {
                sendEvent({
                  type: "snapshot",
                  render: snap.lastSnapshot,
                  step: row.snapshotStep,
                });
              }
            }
            // Reap-on-read: a running/queued job whose execution window has
            // provably passed died without a terminal write — mark it failed
            // so this tail (and every future reattach) closes instead of
            // polling a corpse. Plain write, not withDbRetry (write path).
            // `awaiting_input` (MTR-191) is deliberately EXCLUDED: it's a live
            // suspend on user input bounded by the question's own timeout, not
            // a dead job — reaping it would kill a legitimately-waiting build
            // (and the SQL guard below wouldn't match it anyway, desyncing the
            // local `status`).
            const born = row.startedAt ?? row.createdAt;
            if (
              (status === "running" || status === "queued") &&
              born &&
              Date.now() - born.getTime() > STALE_RUNNING_MS
            ) {
              // Same family as JOB_TIMEOUT_MESSAGE in lib/cad/jobs.ts — the
              // executor should self-timeout before the platform kill, but a
              // crash / OOM / missed deadline still lands here.
              jobError =
                "Generation timed out or was interrupted before finishing. " +
                "Simplify the script (avoid edge-by-edge fillet loops) or " +
                "split into parts, then try again.";
              await db
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
                );
              status = "failed";
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
