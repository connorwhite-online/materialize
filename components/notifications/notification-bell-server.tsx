import { auth } from "@clerk/nextjs/server";
import { eq, and, desc, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { swallow } from "@/lib/utils/swallow";
import {
  NotificationBell,
  type NotificationItem,
} from "./notification-bell";

const RECENT_LIMIT = 20;

interface Props {
  className?: string;
}

/**
 * Server-side wrapper around the notification bell. Resolves auth,
 * fetches the unread count + most recent N items, and hands them to
 * the client bell component. Returns null for anon viewers — there
 * are no notifications to show.
 *
 * Both bell instances on a page (top-nav for mobile, sidebar for
 * desktop) render this independently. Each does its own fetch — small
 * cost (two indexed queries against an indexed table), and avoids the
 * complexity of memoizing across two render trees.
 */
export async function NotificationBellServer({ className }: Props) {
  const { userId } = await auth();
  if (!userId) return null;

  const [recentRows, countRows] = await Promise.all([
    swallow(
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
        .limit(RECENT_LIMIT)
    ),
    swallow(
      db
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt)
          )
        )
    ),
  ]);

  const unreadCount = countRows[0]?.value ?? 0;
  const recent: NotificationItem[] = recentRows.map((r) => ({
    id: r.id,
    type: r.type as NotificationItem["type"],
    payload: r.payload as NotificationItem["payload"],
    readAt: r.readAt,
    createdAt: r.createdAt,
  }));

  return (
    <NotificationBell
      unreadCount={unreadCount}
      recent={recent}
      className={className}
    />
  );
}
