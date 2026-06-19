import { auth } from "@clerk/nextjs/server";
import { eq, and, desc, isNull, count } from "drizzle-orm";
import { Client } from "@neondatabase/serverless";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Hold the SSE stream open up to ~55s (see STREAM_TTL_MS); 60s is the
// platform ceiling so we keep ~5s headroom before the platform kills
// it. Longer-lived connections mean each tab reconnects (and re-runs
// loadSnapshot + re-issues LISTEN) less than half as often, which cuts
// the per-tab Neon query churn roughly in half with no UX change — the
// heartbeat keeps the connection healthy across the longer window.
export const maxDuration = 60;

const RECENT_LIMIT = 20;
const STREAM_TTL_MS = 55_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_HINT_MS = 3_000;

type NotificationRow = {
  id: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

type Snapshot = { unreadCount: number; recent: NotificationRow[] };

/**
 * Server-sent events stream powering the notification bell. Replaced
 * the prior 30s client polling at /api/notifications/recent.
 *
 * Push transport is Postgres LISTEN/NOTIFY over Neon's WebSocket
 * driver: a trigger on `notifications` (migration 0019) fires
 * `pg_notify('notifications', '{userId, id}')` on every insert, and
 * this handler holds a WS session running `LISTEN notifications` for
 * the lifetime of the stream. When an event matching the authed
 * userId arrives we re-fetch the snapshot once and push it.
 *
 * Re-fetch (instead of relaying the row from the NOTIFY payload)
 * keeps the channel payload tiny — the bell needs a count plus the
 * top-20 ordered by createdAt, which is cheaper to recompute via
 * the existing indexed query than to thread through every
 * notify*() call site.
 *
 * Cross-tab read-state sync is also wired in: the mark-read server
 * actions in app/actions/notifications.ts call pg_notify on the
 * same `notifications` channel after every successful read mutation
 * (with no `id` in the payload, signaling a generic snapshot
 * refresh). Other tabs / devices belonging to the same user get the
 * updated unread count in the same one-round-trip the trigger uses
 * for new inserts.
 *
 * The stream auto-closes after STREAM_TTL_MS so each connection has
 * a predictable lifetime; the browser EventSource auto-reconnects
 * via the server-supplied retry: hint.
 */
async function loadSnapshot(userId: string): Promise<Snapshot> {
  const [recent, countRows] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(RECENT_LIMIT),
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt))
      ),
  ]);
  return {
    unreadCount: countRows[0]?.value ?? 0,
    recent: recent as NotificationRow[],
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return new Response("Misconfigured", { status: 500 });

  const encoder = new TextEncoder();
  let cancelled = false;
  let listener: Client | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cancelled = true;
        }
      };
      const sendSnapshot = (snap: Snapshot) =>
        send(`data: ${JSON.stringify(snap)}\n\n`);
      const sendHeartbeat = () => send(`: keepalive\n\n`);

      // Sticky retry hint for the EventSource — used only if the
      // connection drops abnormally; clean closures still race the
      // browser reconnect heuristic.
      send(`retry: ${RECONNECT_HINT_MS}\n\n`);

      let lastEmitAt = Date.now();

      try {
        const initial = await loadSnapshot(userId);
        sendSnapshot(initial);
        lastEmitAt = Date.now();
      } catch (error) {
        logError("api/notifications/stream initial", error);
      }

      // Coalesce concurrent NOTIFY events: if a re-fetch is already
      // in-flight, skip — by the time it resolves, its snapshot
      // already reflects whatever just arrived.
      let pushPending = false;

      try {
        listener = new Client(dbUrl);
        await listener.connect();
        listener.on("notification", async (msg) => {
          if (cancelled) return;
          if (msg.channel !== "notifications") return;
          let payload: { userId?: string } | null = null;
          try {
            payload = msg.payload ? JSON.parse(msg.payload) : null;
          } catch {
            payload = null;
          }
          if (!payload || payload.userId !== userId) return;
          if (pushPending) return;
          pushPending = true;
          try {
            const snap = await loadSnapshot(userId);
            if (!cancelled) {
              sendSnapshot(snap);
              lastEmitAt = Date.now();
            }
          } catch (error) {
            logError("api/notifications/stream push", error);
          } finally {
            pushPending = false;
          }
        });
        await listener.query("LISTEN notifications");
      } catch (error) {
        // If LISTEN setup fails we keep the stream alive on
        // heartbeats only — the next reconnect cycle retries the
        // whole flow, including the initial snapshot.
        logError("api/notifications/stream listen-setup", error);
      }

      const startedAt = Date.now();
      while (!cancelled && Date.now() - startedAt < STREAM_TTL_MS) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cancelled) break;
        if (Date.now() - lastEmitAt >= HEARTBEAT_INTERVAL_MS) {
          sendHeartbeat();
          lastEmitAt = Date.now();
        }
      }

      try {
        await listener?.end();
      } catch {
        // Already closed — ignore.
      }
      try {
        controller.close();
      } catch {
        // Already closed by the client side — fine.
      }
    },
    async cancel() {
      cancelled = true;
      try {
        await listener?.end();
      } catch {
        // Already closed — ignore.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      // Disable nginx-style proxy buffering — without this an
      // intermediate buffer can hold the early frames until the
      // stream closes, breaking the realtime feel.
      "X-Accel-Buffering": "no",
    },
  });
}
