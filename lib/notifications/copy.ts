import type {
  BuildOnFilePayload,
  CollaboratorAddedToProjectPayload,
  CommentOnListingPayload,
  NotificationType,
  PrintOnFilePayload,
  PurchaseOnListingPayload,
  RefundOnListingPayload,
  ReplyToCommentPayload,
} from "./types";

/**
 * Headline + one-line detail for a notification, shared by every
 * channel that speaks outside the app: email (subject + body) and web
 * push (title + body). Pure so both stay word-for-word the same and
 * are testable without Clerk, Resend or a push service.
 */
export type NotificationContentPayload =
  | CommentOnListingPayload
  | ReplyToCommentPayload
  | BuildOnFilePayload
  | PrintOnFilePayload
  | PurchaseOnListingPayload
  | RefundOnListingPayload
  | CollaboratorAddedToProjectPayload;

export function notificationHeadline(
  type: NotificationType,
  payload: NotificationContentPayload
): string {
  // Self-notification, no external actor to name (walk-away UX).
  if (type === "cad_build_finished") {
    const ok = (payload as { ok?: boolean }).ok;
    return ok
      ? `Your build "${payload.listing.name}" is ready`
      : `Your build "${payload.listing.name}" didn't finish`;
  }
  const actor =
    payload.actor.displayName || payload.actor.username || "Someone";
  const listing = payload.listing.name;
  const targetWord = payload.listing.kind === "file" ? "file" : "project";
  switch (type) {
    case "comment_on_listing":
      return `${actor} commented on your ${targetWord} ${listing}`;
    case "reply_to_comment":
      return `${actor} replied to your comment on ${listing}`;
    case "build_on_file":
      return `${actor} added a photo to your ${targetWord} ${listing}`;
    case "print_on_file":
      return `${actor} just printed your ${targetWord} ${listing}`;
    case "purchase_on_listing":
      return `${actor} bought your ${targetWord} ${listing}`;
    case "refund_on_listing":
      return `Refund issued on your ${targetWord} ${listing}`;
    case "collaborator_added_to_project":
      return `${actor} added you as a collaborator on ${listing}`;
  }
}

/**
 * The one extra detail under the headline. Comment-style payloads carry
 * a `snippet`; print payloads carry a `materialLabel`, surfaced through
 * the same slot; sales carry an amount.
 */
export function notificationSnippet(
  type: NotificationType,
  payload: NotificationContentPayload
): string | null {
  if (type === "purchase_on_listing" || type === "refund_on_listing") {
    const p = payload as PurchaseOnListingPayload | RefundOnListingPayload;
    // Refunds get a leading minus to read as a negative.
    const sign = type === "refund_on_listing" ? "-" : "";
    return `${sign}$${(p.snippet.amountCents / 100).toFixed(2)} ${p.snippet.currency}`;
  }
  if ("snippet" in payload) {
    return (payload as { snippet: string | null }).snippet ?? null;
  }
  if ("materialLabel" in payload) {
    return (payload as { materialLabel: string | null }).materialLabel;
  }
  return null;
}
