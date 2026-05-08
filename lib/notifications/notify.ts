import "server-only";

import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import type {
  CommentOnListingPayload,
  MakeOnFilePayload,
  NotificationType,
  ReplyToCommentPayload,
} from "./types";

/**
 * Fire-and-forget notification insert. Wraps the DB write in a try /
 * catch so a transient Neon hiccup never breaks the parent action
 * (a comment posting succeeds even if the notification fails to
 * write — the notification is a side effect, not the contract).
 *
 * Recipients of self-events are skipped — we don't notify you that
 * you commented on your own listing or replied to your own comment.
 */
async function insert(
  recipientId: string,
  actorId: string,
  type: NotificationType,
  payload: object
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
