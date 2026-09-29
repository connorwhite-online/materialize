import "server-only";

import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import type { PushMessage } from "./message";

/**
 * Web Push is on only when all three VAPID settings are present. The
 * public key is NEXT_PUBLIC_ because the browser needs it to subscribe;
 * it's a public key, so baking it into the bundle is the point. Without
 * them every send is a silent no-op, so deploying this before the keys
 * exist changes nothing.
 */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidSet = true;
}

/** Push service answers meaning "this subscription is gone for good". */
function isGone(error: unknown): boolean {
  const code = (error as { statusCode?: number } | null)?.statusCode;
  return code === 404 || code === 410;
}

export interface PushSendResult {
  sent: number;
  removed: number;
}

/**
 * Send one message to every device the user subscribed. Best-effort in
 * the same way as the email side-effect: errors are logged, never
 * thrown, so a push hiccup can't fail the action that caused it.
 * Subscriptions the push service reports gone (404/410, e.g. the app
 * was removed from the Home Screen) are deleted.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0 };
  if (!isPushConfigured()) return result;
  try {
    ensureVapid();
    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (subs.length === 0) return result;

    const body = JSON.stringify(message);
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24 }
          );
          result.sent++;
        } catch (error) {
          if (isGone(error)) gone.push(s.id);
          else logError("sendPushToUser", error);
        }
      })
    );

    if (gone.length > 0) {
      await db
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.id, gone));
      result.removed = gone.length;
    }
  } catch (error) {
    logError("sendPushToUser", error);
  }
  return result;
}
