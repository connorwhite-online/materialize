import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail } from "@/lib/email/client";
import { NotificationEmail } from "@/lib/email/templates/notification";
import { logError } from "@/lib/logger";
import {
  notificationHeadline,
  notificationSnippet,
  type NotificationContentPayload as AnyEmailPayload,
} from "./copy";
import type {
  BuildOnFilePayload,
  CommentOnListingPayload,
  NotificationType,
  PrintOnFilePayload,
  ReplyToCommentPayload,
} from "./types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Send a single notification email to the recipient. Caller has
 * already verified the recipient's `emailNotificationsEnabled` pref;
 * we just look up the recipient's primary email via Clerk and fire.
 *
 * Errors are swallowed — same posture as the in-app notification
 * insert: best-effort, never break the parent action.
 */
export async function sendNotificationEmail(
  recipientId: string,
  type: NotificationType,
  payload: AnyEmailPayload
) {
  try {
    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(recipientId);
    const email = clerkUser?.primaryEmailAddress?.emailAddress;
    if (!email) {
      logError(
        "sendNotificationEmail",
        new Error(`recipient ${recipientId} has no primary email`)
      );
      return;
    }

    const headline = notificationHeadline(type, payload);
    const subject = `Materialize — ${headline}`;
    const href = buildHref(type, payload);
    const settingsUrl = `${APP_URL}/dashboard/settings`;
    const snippet = notificationSnippet(type, payload);

    await sendEmail({
      to: email,
      subject,
      react: NotificationEmail({ headline, snippet, href, settingsUrl }),
      text: buildPlainText(headline, snippet, href, settingsUrl),
    });
  } catch (error) {
    logError(`sendNotificationEmail(${type})`, error);
  }
}

function buildHref(
  type: NotificationType,
  payload: AnyEmailPayload
): string {
  // Studio builds deep-link to the studio itself (reattach/history shows
  // the finished part) — there is no listing page yet for an unsaved draft.
  if (type === "cad_build_finished") return `${APP_URL}/prometheus`;
  const base =
    payload.listing.kind === "file"
      ? `${APP_URL}/files/${payload.listing.slug}`
      : `${APP_URL}/projects/${payload.listing.slug}`;
  if (type === "build_on_file") {
    return `${base}#build-${(payload as BuildOnFilePayload).buildId}`;
  }
  if (type === "print_on_file") {
    // Link the creator to the order detail page rather than the file
    // page — the meaningful action from a "someone printed your file"
    // email is reviewing the order.
    return `${APP_URL}/dashboard/orders/${(payload as PrintOnFilePayload).printOrderId}`;
  }
  if (type === "purchase_on_listing" || type === "refund_on_listing") {
    // Sales activity (including refunds) lives on the earnings tab.
    // Surfacing one event alone isn't actionable — sending the
    // creator to their full sales view is more useful than the
    // listing page they already know about.
    return `${APP_URL}/dashboard/earnings`;
  }
  if (type === "collaborator_added_to_project") {
    // Land straight on the project page — that's the whole point of
    // the invite.
    return base;
  }
  const commentId =
    type === "comment_on_listing"
      ? (payload as CommentOnListingPayload).commentId
      : (payload as ReplyToCommentPayload).commentId;
  return `${base}#comment-${commentId}`;
}

function buildPlainText(
  headline: string,
  snippet: string | null,
  href: string,
  settingsUrl: string
): string {
  const lines = [headline];
  if (snippet) {
    lines.push("");
    lines.push(`"${snippet}"`);
  }
  lines.push("");
  lines.push(`View: ${href}`);
  lines.push("");
  lines.push(
    `You can turn off these emails in your account settings: ${settingsUrl}`
  );
  return lines.join("\n");
}
