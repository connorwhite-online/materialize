import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and, desc, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

const RECENT_LIMIT = 20;

/**
 * Polled by the notification bell on a short interval (default 30s
 * while visible) to surface new comments/replies/makes without making
 * the user reload the page.
 *
 * Returns the same shape that the server-side `NotificationBellServer`
 * computes on page load, so the bell can swap the props in place. The
 * route stays cheap — two indexed queries against `notifications`
 * filtered by `userId`. No 304 / ETag plumbing yet; the bell is small
 * enough that always-200 is fine for v1.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [recentRows, countRows] = await Promise.all([
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
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt)
          )
        ),
    ]);

    return NextResponse.json(
      {
        unreadCount: countRows[0]?.value ?? 0,
        recent: recentRows,
      },
      {
        headers: {
          // Polled per-user — must never cache between users, and must
          // not stick on the edge for fresh-list semantics.
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch (error) {
    logError("api/notifications/recent", error);
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 }
    );
  }
}
