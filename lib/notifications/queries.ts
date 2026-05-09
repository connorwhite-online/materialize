import "server-only";

import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { swallow } from "@/lib/utils/swallow";

/**
 * Initial unread-notification count for the currently authed user.
 * Returns 0 for anon viewers and on transient failure — both
 * indistinguishable from "no unread" in the UI, which is fine for a
 * passive dot indicator. The SSE stream is the source of truth once
 * the page has hydrated.
 */
export async function getMyUnreadNotificationCount(): Promise<number> {
  const { userId } = await auth();
  if (!userId) return 0;

  const rows = await swallow(
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt))
      )
  );
  return rows[0]?.value ?? 0;
}
