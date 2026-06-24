import { NextResponse } from "next/server";
import { getMyUnreadNotificationCount } from "@/lib/notifications/queries";

export const dynamic = "force-dynamic";

/**
 * Lightweight unread-count poll for the avatar dot.
 *
 * Replaced the persistent SSE/LISTEN stream (/api/notifications/stream):
 * that held an open Postgres connection per visible tab, which kept
 * Neon from auto-suspending (scale-to-zero) the entire time anyone had
 * the app open — the dominant idle compute cost. The avatar only ever
 * read `unreadCount` off the snapshot, so a periodic poll of a single
 * indexed count query carries the same signal while letting the DB
 * sleep between polls. The trade is up to one poll interval of latency
 * on the badge (see AvatarWithUnreadDot), which is an accepted
 * cost/UX tradeoff.
 *
 * getMyUnreadNotificationCount is auth-guarded and returns 0 for anon
 * or on transient failure, so this never throws.
 */
export async function GET() {
  const unreadCount = await getMyUnreadNotificationCount();
  return NextResponse.json(
    { unreadCount },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
