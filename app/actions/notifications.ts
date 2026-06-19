"use server";

import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

type Result = { ok: true } | { error: string };

// Note: the mark-read actions used to fire a `pg_notify('notifications')`
// so the SSE stream could push the new unread count to other tabs. The
// stream was replaced by a periodic poll (AvatarWithUnreadDot), so the
// NOTIFY had no listener and was a wasted DB round-trip per mark-read —
// removed. Cross-tab read state now reconciles on the next poll, and
// the current tab updates immediately via revalidatePath below.

/**
 * Mark a single notification as read. The bell calls this when the
 * user clicks an item, immediately before navigating to the source.
 *
 * Returns ok regardless of whether the row was already read or
 * doesn't exist — the user-facing intent ("treat as read") is
 * idempotent and we don't want a stale row to surface a confusing
 * error toast.
 */
export async function markNotificationRead(notificationId: string): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt)
        )
      );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    logError("markNotificationRead", error);
    return { error: "Failed to mark as read" };
  }
}

/**
 * Mark every unread notification as read for the current user. The
 * bell exposes this on a "mark all read" button so a flooded inbox
 * doesn't require N clicks to clear.
 */
export async function markAllNotificationsRead(): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt))
      );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    logError("markAllNotificationsRead", error);
    return { error: "Failed to mark all as read" };
  }
}

/**
 * Mark a batch of notification ids as read. The bell uses this to
 * mark visible-on-open items as read in one round trip when the user
 * opens the dropdown — better UX than per-row marking, and avoids
 * scattering small writes for popular accounts.
 */
export async function markNotificationsRead(
  ids: string[]
): Promise<Result> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };
    if (ids.length === 0) return { ok: true };
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.id, ids),
          isNull(notifications.readAt)
        )
      );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    logError("markNotificationsRead", error);
    return { error: "Failed to mark as read" };
  }
}
