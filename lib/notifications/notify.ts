import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { sendNotificationEmail } from "./email";
import type {
  CommentOnListingPayload,
  MakeOnFilePayload,
  NotificationType,
  PrintOnFilePayload,
  ReplyToCommentPayload,
} from "./types";

/**
 * Insert a notification + fire the corresponding email if the
 * recipient has email notifications enabled. Both writes wrapped so a
 * transient Neon / Resend hiccup never breaks the parent action — a
 * comment posting succeeds even if the notification side-effects fail
 * (notifications are not the contract).
 *
 * Recipients of self-events are skipped — we don't notify you that
 * you commented on your own listing or replied to your own comment.
 *
 * Email send is fired without await: it does an external HTTP call
 * (Clerk for the email lookup, Resend for delivery) which would
 * otherwise add hundreds of ms to the parent action. We capture the
 * Promise via `void` so the lint isn't unhappy and any thrown error
 * is logged via the email helper's own try/catch.
 */
async function insert(
  recipientId: string,
  actorId: string,
  type: NotificationType,
  payload:
    | CommentOnListingPayload
    | ReplyToCommentPayload
    | MakeOnFilePayload
    | PrintOnFilePayload
) {
  if (recipientId === actorId) return;
  try {
    await db.insert(notifications).values({
      userId: recipientId,
      type,
      payload,
    });
  } catch (error) {
    logError(`notify(${type})`, error);
  }

  // Email side-effect — opt-in via the user's pref. Look up the row
  // we just touched to read the toggle; if it's off, skip the send.
  try {
    const [recipient] = await db
      .select({
        id: users.id,
        emailEnabled: users.emailNotificationsEnabled,
      })
      .from(users)
      .where(eq(users.id, recipientId));
    if (recipient?.emailEnabled) {
      // Don't await — email send is best-effort. Errors logged inside.
      void sendNotificationEmail(recipientId, type, payload);
    }
  } catch (error) {
    logError(`notify(${type}) email-pref-lookup`, error);
  }
}

export async function notifyCommentOnListing(
  recipientId: string,
  payload: CommentOnListingPayload
) {
  return insert(
    recipientId,
    payload.actor.id,
    "comment_on_listing",
    payload
  );
}

export async function notifyReplyToComment(
  recipientId: string,
  payload: ReplyToCommentPayload
) {
  return insert(
    recipientId,
    payload.actor.id,
    "reply_to_comment",
    payload
  );
}

export async function notifyMakeOnFile(
  recipientId: string,
  payload: MakeOnFilePayload
) {
  return insert(recipientId, payload.actor.id, "make_on_file", payload);
}

export async function notifyPrintOnFile(
  recipientId: string,
  payload: PrintOnFilePayload
) {
  return insert(recipientId, payload.actor.id, "print_on_file", payload);
}
