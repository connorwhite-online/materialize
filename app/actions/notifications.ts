"use server";

import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

type Result = { ok: true } | { error: string };

/**
 * Fire a `notifications` channel NOTIFY from the mark-read actions
 * so the SSE handler in /api/notifications/stream re-fetches and
 * pushes the new unread count to OTHER tabs / devices belonging to
 * the same user. The trigger on INSERT (migration 0019) emits an
 * `id` alongside `userId`; we omit `id` here so the SSE listener
 * treats it as a generic "snapshot may have changed" event and re-
 * fetches without trying to single-out a specific row.
 *
 * Best-effort — wrapped in try/catch because the actual DB mutation
 * already succeeded by the time we get here; a NOTIFY failure
 * should not bubble up to the user.
 */
async function notifyReadChange(userId: string) {
  try {
    const payload = JSON.stringify({ userId });
    await db.execute(sql`SELECT pg_notify('notifications', ${payload})`);
  } catch (error) {
    logError("notifyReadChange", error);
  }
}

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
    await notifyReadChange(userId);
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
    await notifyReadChange(userId);
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
    await notifyReadChange(userId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    logError("markNotificationsRead", error);
    return { error: "Failed to mark as read" };
  }
}
