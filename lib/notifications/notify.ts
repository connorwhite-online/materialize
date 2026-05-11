import "server-only";

import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { sendNotificationEmail } from "./email";
import { shouldSendEmail } from "./email-prefs";
import type {
  CommentOnListingPayload,
  BuildOnFilePayload,
  NotificationType,
  PrintOnFilePayload,
  PurchaseOnListingPayload,
  RefundOnListingPayload,
  ReplyToCommentPayload,
} from "./types";
export type { PurchaseSnippet } from "./types";

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
    | BuildOnFilePayload
    | PrintOnFilePayload
    | PurchaseOnListingPayload
    | RefundOnListingPayload
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

  // Email side-effect — opt-in via the user's prefs (master switch
  // + per-type override). `shouldSendEmail` rolls both checks into a
  // single round trip.
  try {
    if (await shouldSendEmail(recipientId, type)) {
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

export async function notifyBuildOnFile(
  recipientId: string,
  payload: BuildOnFilePayload
) {
  return insert(recipientId, payload.actor.id, "build_on_file", payload);
}

export async function notifyPrintOnFile(
  recipientId: string,
  payload: PrintOnFilePayload
) {
  return insert(recipientId, payload.actor.id, "print_on_file", payload);
}

export async function notifyPurchaseOnListing(
  recipientId: string,
  payload: PurchaseOnListingPayload
) {
  return insert(
    recipientId,
    payload.actor.id,
    "purchase_on_listing",
    payload
  );
}

export async function notifyRefundOnListing(
  recipientId: string,
  payload: RefundOnListingPayload
) {
  return insert(
    recipientId,
    payload.actor.id,
    "refund_on_listing",
    payload
  );
}
