"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";
import { isPushConfigured, sendPushToUser } from "@/lib/push/send";

type Result = { ok: true } | { error: string };

// Shape of PushSubscription.toJSON() in the browser.
const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, {
    message: "Unsupported push service",
  }),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

/**
 * Save this device's push subscription for the signed-in user. Upserts
 * on endpoint, so calling it again (every settings open re-syncs) is
 * harmless, and a device that signs in as someone else moves over to
 * them instead of pushing the previous user's notifications.
 */
export async function savePushSubscription(
  subscription: unknown,
  userAgent?: string
): Promise<Result> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };
  if (!isPushConfigured()) return { error: "Push notifications aren't set up" };

  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { error: "Invalid subscription" };
  const { endpoint, keys } = parsed.data;
  const ua = userAgent?.slice(0, 512) ?? null;

  try {
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
      });
    return { ok: true };
  } catch (error) {
    logError("savePushSubscription", error);
    return { error: "Couldn't turn on notifications" };
  }
}

/** Forget this device. Scoped to the caller so nobody can drop another user's. */
export async function removePushSubscription(endpoint: string): Promise<Result> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };
  try {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, userId)
        )
      );
    return { ok: true };
  } catch (error) {
    logError("removePushSubscription", error);
    return { error: "Couldn't turn off notifications" };
  }
}

/** Send a test push to every device the caller subscribed. */
export async function sendTestPush(): Promise<Result> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };
  const { sent } = await sendPushToUser(userId, {
    title: "Notifications are on",
    body: "This is how Materialize will reach you.",
    url: "/notifications",
    tag: "test",
  });
  return sent > 0 ? { ok: true } : { error: "No device received it" };
}
