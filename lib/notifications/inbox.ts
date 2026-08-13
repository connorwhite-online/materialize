import type {
  BuildOnFilePayload,
  CommentOnListingPayload,
  CollaboratorAddedToProjectPayload,
  NotificationType,
  PrintOnFilePayload,
  PurchaseOnListingPayload,
  RefundOnListingPayload,
  ReplyToCommentPayload,
} from "@/lib/notifications/types";

export type NotificationPayload =
  | CommentOnListingPayload
  | ReplyToCommentPayload
  | BuildOnFilePayload
  | PrintOnFilePayload
  | PurchaseOnListingPayload
  | RefundOnListingPayload
  | CollaboratorAddedToProjectPayload;

export type NotificationRow = {
  id: string;
  type: NotificationType;
  payload: NotificationPayload;
  readAt: Date | null;
  createdAt: Date;
};

type SafeListing = { kind: "file" | "project"; name: string; slug: string };

export const NOTIFICATIONS_FALLBACK_HREF = "/dashboard";

/**
 * `notifications.type` is free-form text and `payload` is untyped jsonb.
 * Every renderer reads `actor.displayName` unguarded, so this is the
 * runtime check that makes that promise safe. A non-string `actor.id`
 * throws inside `getAvatarGradient` (`str.length` on `undefined`).
 */
export function hasUsableActor(
  payload: unknown
): payload is NotificationPayload {
  if (!payload || typeof payload !== "object") return false;
  const actor = (payload as { actor?: unknown }).actor;
  if (!actor || typeof actor !== "object") return false;
  return typeof (actor as { id?: unknown }).id === "string";
}

/**
 * Safely extracts `listing` from a row's payload. Returns null rather
 * than throwing so a single bad row degrades instead of taking down
 * the inbox.
 */
export function getListing(n: NotificationRow): SafeListing | null {
  const listing = (n.payload as { listing?: unknown } | null | undefined)
    ?.listing as { kind?: unknown; name?: unknown; slug?: unknown } | undefined;
  if (
    listing &&
    typeof listing === "object" &&
    (listing.kind === "file" || listing.kind === "project") &&
    typeof listing.name === "string" &&
    typeof listing.slug === "string"
  ) {
    return listing as SafeListing;
  }
  return null;
}

export function buildHref(n: NotificationRow): string {
  if (n.type === "cad_build_finished") {
    return "/prometheus";
  }
  if (n.type === "print_on_file") {
    const printOrderId = (n.payload as Partial<PrintOnFilePayload>)
      .printOrderId;
    return typeof printOrderId === "string"
      ? `/dashboard/orders/${printOrderId}`
      : NOTIFICATIONS_FALLBACK_HREF;
  }
  if (n.type === "purchase_on_listing" || n.type === "refund_on_listing") {
    return `/dashboard/earnings`;
  }

  const listing = getListing(n);
  if (!listing) return NOTIFICATIONS_FALLBACK_HREF;
  const base =
    listing.kind === "file"
      ? `/files/${listing.slug}`
      : `/projects/${listing.slug}`;

  if (n.type === "build_on_file") {
    return `${base}#build-${(n.payload as BuildOnFilePayload).buildId}`;
  }
  if (n.type === "collaborator_added_to_project") {
    return base;
  }
  if (n.type === "comment_on_listing" || n.type === "reply_to_comment") {
    const commentId =
      n.type === "comment_on_listing"
        ? (n.payload as CommentOnListingPayload).commentId
        : (n.payload as ReplyToCommentPayload).commentId;
    return `${base}#comment-${commentId}`;
  }
  return base;
}

export function buildMessage(n: NotificationRow): string {
  switch (n.type) {
    case "comment_on_listing":
      return "commented";
    case "reply_to_comment":
      return "replied to your comment";
    case "build_on_file":
      return "added a photo";
    case "print_on_file":
      return "just printed";
    case "purchase_on_listing":
      return "bought";
    case "refund_on_listing":
      return "was refunded for";
    case "collaborator_added_to_project":
      return "added you as a collaborator on";
    case "cad_build_finished":
      return (n.payload as { ok?: boolean }).ok
        ? "finished building"
        : "couldn't finish building";
    default:
      return "sent you a notification";
  }
}

export function pickSnippet(n: NotificationRow): string | null {
  if (n.type === "purchase_on_listing" || n.type === "refund_on_listing") {
    const p = n.payload as
      | PurchaseOnListingPayload
      | RefundOnListingPayload;
    const sign = n.type === "refund_on_listing" ? "-" : "";
    return `${sign}$${(p.snippet.amountCents / 100).toFixed(2)} ${p.snippet.currency}`;
  }
  if ("snippet" in n.payload) {
    return (n.payload as { snippet: string | null }).snippet ?? null;
  }
  if ("materialLabel" in n.payload) {
    return (n.payload as { materialLabel: string | null }).materialLabel;
  }
  return null;
}
