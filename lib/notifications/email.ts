import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail } from "@/lib/email/client";
import { NotificationEmail } from "@/lib/email/templates/notification";
import { logError } from "@/lib/logger";
import type {
  CommentOnListingPayload,
  MakeOnFilePayload,
  NotificationType,
  PrintOnFilePayload,
  PurchaseOnListingPayload,
  ReplyToCommentPayload,
} from "./types";

type AnyEmailPayload =
  | CommentOnListingPayload
  | ReplyToCommentPayload
  | MakeOnFilePayload
  | PrintOnFilePayload
  | PurchaseOnListingPayload;

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

    const headline = buildHeadline(type, payload);
    const subject = `Materialize — ${headline}`;
    const href = buildHref(type, payload);
    const settingsUrl = `${APP_URL}/dashboard/settings`;
    // Comment-style payloads carry a `snippet`; print payloads carry a
    // `materialLabel` which we surface in the email body via that
    // same slot so the user gets one extra detail above the CTA.
    let snippet: string | null = null;
    if (type === "purchase_on_listing") {
      const p = payload as PurchaseOnListingPayload;
      // Format the amount as the email's "snippet" slot — the template
      // surfaces it under the headline as a small detail line.
      snippet = `$${(p.snippet.amountCents / 100).toFixed(2)} ${p.snippet.currency}`;
    } else if ("snippet" in payload) {
      snippet = (payload as { snippet: string | null }).snippet ?? null;
    } else if ("materialLabel" in payload) {
      snippet = (payload as { materialLabel: string | null }).materialLabel;
    }

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

function buildHeadline(
  type: NotificationType,
  payload: AnyEmailPayload
): string {
  const actor =
    payload.actor.displayName || payload.actor.username || "Someone";
  const listing = payload.listing.name;
  const targetWord = payload.listing.kind === "file" ? "file" : "project";
  switch (type) {
    case "comment_on_listing":
      return `${actor} commented on your ${targetWord} ${listing}`;
    case "reply_to_comment":
      return `${actor} replied to your comment on ${listing}`;
    case "make_on_file":
      return `${actor} added a photo to your ${targetWord} ${listing}`;
    case "print_on_file":
      return `${actor} just printed your ${targetWord} ${listing}`;
    case "purchase_on_listing":
      return `${actor} bought your ${targetWord} ${listing}`;
  }
}

function buildHref(
  type: NotificationType,
  payload: AnyEmailPayload
): string {
  const base =
    payload.listing.kind === "file"
      ? `${APP_URL}/files/${payload.listing.slug}`
      : `${APP_URL}/projects/${payload.listing.slug}`;
  if (type === "make_on_file") {
    return `${base}#make-${(payload as MakeOnFilePayload).makeId}`;
  }
  if (type === "print_on_file") {
    // Link the creator to the order detail page rather than the file
    // page — the meaningful action from a "someone printed your file"
    // email is reviewing the order.
    return `${APP_URL}/dashboard/orders/${(payload as PrintOnFilePayload).printOrderId}`;
  }
  if (type === "purchase_on_listing") {
    // Sales activity lives on the earnings tab. Surfacing one sale
    // alone isn't actionable — sending the creator to their full
    // sales view is more useful than the listing page they already
    // know about.
    return `${APP_URL}/dashboard/earnings`;
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
