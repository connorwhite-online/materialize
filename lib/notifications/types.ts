/**
 * Notification event types and their payload shapes.
 *
 * The DB stores `type` as free-form text + a JSONB payload, so adding
 * a new event type doesn't need a schema migration — only an entry
 * here. All current types follow a simple "actor did X to Y" shape
 * with denormalized fields so the bell can render without joins.
 *
 * Why denormalize: a notification keeps rendering even after the
 * source comment is deleted, the listing is renamed, or the actor
 * changes their handle. Trade-off is mild staleness in old rows;
 * acceptable for an inbox.
 */

export type NotificationType =
  | "comment_on_listing"
  | "reply_to_comment"
  | "make_on_file"
  | "print_on_file"
  | "purchase_on_listing"
  | "refund_on_listing";

interface ActorSnapshot {
  /** User id of whoever triggered the event. */
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ListingRef {
  /** "file" or "project" — drives the deep link path. */
  kind: "file" | "project";
  /** Display name at insert time; renders even if later renamed. */
  name: string;
  /** Slug for the deep link — survives renames. */
  slug: string;
}

export interface CommentOnListingPayload {
  actor: ActorSnapshot;
  listing: ListingRef;
  commentId: string;
  /** Up to ~140 chars of body, plain-text. Used in the bell preview. */
  snippet: string;
}

export interface ReplyToCommentPayload {
  actor: ActorSnapshot;
  listing: ListingRef;
  commentId: string;
  parentCommentId: string;
  snippet: string;
}

export interface MakeOnFilePayload {
  actor: ActorSnapshot;
  listing: ListingRef; // always kind: 'file'
  makeId: string;
  /** Caption snippet if the make has one, else null. */
  snippet: string | null;
}

export interface PrintOnFilePayload {
  /** Buyer who placed the order. */
  actor: ActorSnapshot;
  listing: ListingRef; // always kind: 'file'
  /** ID of the printOrders row, used for the deep-link to the order detail. */
  printOrderId: string;
  /** Resolved material display string, e.g. "PLA Black". Null if the catalog lookup missed. */
  materialLabel: string | null;
}

export interface PurchaseSnippet {
  /** Amount the buyer paid, in the smallest currency unit. */
  amountCents: number;
  /** ISO-4217 currency code (today always USD). */
  currency: string;
}

export interface PurchaseOnListingPayload {
  /** Buyer who completed the Stripe checkout. */
  actor: ActorSnapshot;
  listing: ListingRef; // either kind
  snippet: PurchaseSnippet;
}

export interface RefundOnListingPayload {
  /** Buyer whose purchase was refunded. */
  actor: ActorSnapshot;
  listing: ListingRef;
  snippet: PurchaseSnippet;
}

export type NotificationPayload =
  | (CommentOnListingPayload & { type: "comment_on_listing" })
  | (ReplyToCommentPayload & { type: "reply_to_comment" })
  | (MakeOnFilePayload & { type: "make_on_file" })
  | (PrintOnFilePayload & { type: "print_on_file" })
  | (PurchaseOnListingPayload & { type: "purchase_on_listing" })
  | (RefundOnListingPayload & { type: "refund_on_listing" });

/**
 * Trim a comment body or caption to a short preview safe for the
 * bell dropdown. Single-line, max 140 chars. We do this at insert
 * time so the bell never has to load the full body.
 */
export function makeSnippet(body: string | null, maxLen = 140): string {
  if (!body) return "";
  // Collapse whitespace + newlines so the preview is one line.
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, maxLen - 1).trimEnd() + "…";
}
