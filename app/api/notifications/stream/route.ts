import { auth } from "@clerk/nextjs/server";
import { eq, and, desc, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Hold the SSE stream open up to ~25s (see STREAM_TTL_MS); 60s is the
// platform ceiling so we have headroom if ever needed.
export const maxDuration = 60;

const RECENT_LIMIT = 20;
const STREAM_TTL_MS = 25_000;
const POLL_INTERVAL_MS = 5_000;
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
 * Design tradeoff — Neon's HTTP driver doesn't support LISTEN/NOTIFY,
 * so we emulate "real-time" by polling the DB internally on a tight
 * cadence (POLL_INTERVAL_MS) and pushing a snapshot only when it
 * changes. That increases DB load relative to the old once-per-30s
 * client polling but in exchange gives ~5s push latency and a single
 * persistent HTTP connection per tab. When traffic justifies it the
 * upgrade path is Upstash Redis pub/sub (or a separate Neon WS
 * connection running LISTEN), with the notify*() helpers in
 * lib/notifications/notify.ts publishing on insert.
 *
 * The stream auto-closes after STREAM_TTL_MS so each connection has a
 * predictable lifetime; the browser EventSource auto-reconnects within
 * RECONNECT_HINT_MS. The fingerprint check (snapshotKey) avoids
 * pushing identical snapshots — heartbeats keep proxies from idling
 * the connection out.
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

// Fingerprint: latest createdAt + length + unreadCount. Catches new
// arrivals (createdAt advances) and read-state flips (unreadCount
// changes) without serializing the full payload.
function snapshotKey(s: Snapshot): string {
  if (s.recent.length === 0) return `0|0|${s.unreadCount}`;
  const top = s.recent[0].createdAt;
  const ts = top instanceof Date ? top.getTime() : new Date(top).getTime();
  return `${ts}|${s.recent.length}|${s.unreadCount}`;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;

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

      // Hint the client to reconnect ~3s after we close. Sent once
      // up-front; the field is sticky for the lifetime of the
      // EventSource on the browser side.
      send(`retry: ${RECONNECT_HINT_MS}\n\n`);

      let lastKey = "";
      try {
        const initial = await loadSnapshot(userId);
        lastKey = snapshotKey(initial);
        sendSnapshot(initial);
      } catch (error) {
        logError("api/notifications/stream initial", error);
      }

      let lastEmitAt = Date.now();
      const startedAt = Date.now();

      while (!cancelled && Date.now() - startedAt < STREAM_TTL_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelled) break;
        try {
          const snap = await loadSnapshot(userId);
          const key = snapshotKey(snap);
          if (key !== lastKey) {
            sendSnapshot(snap);
            lastKey = key;
            lastEmitAt = Date.now();
            continue;
          }
        } catch (error) {
          logError("api/notifications/stream tick", error);
        }
        if (Date.now() - lastEmitAt >= HEARTBEAT_INTERVAL_MS) {
          sendHeartbeat();
          lastEmitAt = Date.now();
        }
      }

      try {
        controller.close();
      } catch {
        // Already closed by the client side — fine.
      }
    },
    cancel() {
      cancelled = true;
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
