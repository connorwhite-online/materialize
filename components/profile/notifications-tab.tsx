import Link from "next/link";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/auth/user-avatar";
import { timeAgo } from "@/lib/utils/time";
import { swallow } from "@/lib/utils/swallow";
import { cn } from "@/lib/utils";
import { NotificationsTabActions } from "./notifications-tab-actions";
import type {
  CommentOnListingPayload,
  BuildOnFilePayload,
  CollaboratorAddedToProjectPayload,
  NotificationType,
  PrintOnFilePayload,
  PurchaseOnListingPayload,
  RefundOnListingPayload,
  ReplyToCommentPayload,
} from "@/lib/notifications/types";

const INBOX_LIMIT = 100;

type Payload =
  | CommentOnListingPayload
  | ReplyToCommentPayload
  | BuildOnFilePayload
  | PrintOnFilePayload
  | PurchaseOnListingPayload
  | RefundOnListingPayload
  | CollaboratorAddedToProjectPayload;

// Exported for unit testing (see __tests__/notifications-tab.test.ts).
export type Row = {
  id: string;
  type: NotificationType;
  payload: Payload;
  readAt: Date | null;
  createdAt: Date;
};

// `notifications.type` is free-form text by design (new event types
// don't need a migration — see AGENTS.md "Notifications"), and
// `payload` is an untyped jsonb column. Both the type cast and the
// payload cast below are lies to the type system that hold only if
// every writer stays in sync. This guard is the runtime check that
// makes that promise safe: it's the one thing every renderer actually
// depends on (`actor.displayName` etc., unguarded) rather than
// requiring the full `Payload` shape, which is intentionally more
// permissive per-type (e.g. `listing` is handled separately below via
// `getListing` since even known types can carry a stale/malformed one).
// Exported for unit testing the row-drop guard in isolation (see
// __tests__/notifications-tab.test.ts) — not used outside this
// module otherwise.
export function hasUsableActor(payload: unknown): payload is Payload {
  if (!payload || typeof payload !== "object") return false;
  const actor = (payload as { actor?: unknown }).actor;
  if (!actor || typeof actor !== "object") return false;
  // `id` is the seed `UserAvatar` falls back to when `username` is
  // absent (`seed={actor.username || actor.id}`); a non-string seed
  // throws inside `getAvatarGradient` (`str.length` on `undefined`).
  // Require it explicitly rather than just "actor is an object".
  return typeof (actor as { id?: unknown }).id === "string";
}

type SafeListing = { kind: "file" | "project"; name: string; slug: string };

/**
 * Safely extracts `listing` from a row's payload. Every known payload
 * interface declares `listing` as required, but a malformed or
 * partial row (bad writer, manual insert, future type) can still omit
 * it or ship a non-object — returns null rather than throwing so a
 * single bad row degrades gracefully instead of taking down the tab.
 */
function getListing(n: Row): SafeListing | null {
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

const NOTIFICATIONS_FALLBACK_HREF = "/dashboard";

/**
 * Owner-only Notifications tab. Replaces the prior "Comments" inbox —
 * those events surface here too, alongside replies, photos posted on
 * the user's files, and orders placed against their listings.
 *
 * Rows are mark-read on click via a row-level Link that fires the
 * server action before navigating; "Mark all read" sits in the header
 * action menu.
 */
export async function NotificationsTab({ userId }: { userId: string }) {
  const rows = await swallow(
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(INBOX_LIMIT)
  );

  // A bad row (payload not an object, or no usable `actor`) is data,
  // not an incident — drop it silently rather than letting an
  // unguarded `actor.displayName` read throw and take down the whole
  // tab's server render.
  const items: Row[] = rows
    .filter((r) => hasUsableActor(r.payload))
    .map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      payload: r.payload as Payload,
      readAt: r.readAt,
      createdAt: r.createdAt,
    }));

  const unreadCount = items.filter((r) => !r.readAt).length;

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No notifications yet. Activity on your listings and replies to
          your comments will land here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">
          {unreadCount > 0
            ? `${unreadCount} unread · ${items.length} total`
            : `${items.length} total`}
        </p>
        {unreadCount > 0 && <NotificationsTabActions />}
      </div>
      <Card className="gap-0 py-0 overflow-hidden">
        <div>
          {items.map((row) => (
            <NotificationRow key={row.id} row={row} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function NotificationRow({ row }: { row: Row }) {
  const { actor } = row.payload;
  const listing = getListing(row);
  const href = buildHref(row);
  const message = buildMessage(row);
  const snippet = pickSnippet(row);
  const isUnread = !row.readAt;
  const name = actor.displayName || actor.username || "Anonymous";
  return (
    <Link
      href={href}
      className={cn(
        "flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/40",
        isUnread && "bg-primary/5"
      )}
    >
      <UserAvatar
        seed={actor.username || actor.id}
        imageUrl={actor.avatarUrl}
        displayName={name}
        className="h-8 w-8 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground">{message}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {timeAgo(row.createdAt)}
          </span>
        </div>
        {listing && (
          <div className="text-xs text-muted-foreground">
            on <span className="font-medium">{listing.name}</span>
          </div>
        )}
        {snippet && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {snippet}
          </p>
        )}
      </div>
      {isUnread && (
        <span
          className="mt-2 size-2 shrink-0 rounded-full bg-primary"
          aria-label="Unread"
        />
      )}
    </Link>
  );
}

// Exported for unit testing the link-building decision in isolation
// (see __tests__/notifications-tab.test.ts) — not used outside this
// module otherwise.
export function buildHref(n: Row): string {
  if (n.type === "print_on_file") {
    const printOrderId = (n.payload as Partial<PrintOnFilePayload>)
      .printOrderId;
    return typeof printOrderId === "string"
      ? `/dashboard/orders/${printOrderId}`
      : NOTIFICATIONS_FALLBACK_HREF;
  }
  if (n.type === "purchase_on_listing" || n.type === "refund_on_listing") {
    // Sales activity (including refunds) rolls up on the earnings
    // tab — point there rather than back at the listing page the
    // creator already knows.
    return `/dashboard/earnings`;
  }

  // Every other known type links off the listing — guard it once here
  // rather than per-branch. A row with no usable listing (malformed
  // payload) lands on the dashboard instead of throwing.
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
    // No commentId on this payload (see CollaboratorAddedToProjectPayload)
    // — link straight to the project rather than falling through to the
    // comment-anchor branch below, which would read a nonexistent
    // commentId and produce "#comment-undefined".
    return base;
  }
  if (n.type === "comment_on_listing" || n.type === "reply_to_comment") {
    const commentId =
      n.type === "comment_on_listing"
        ? (n.payload as CommentOnListingPayload).commentId
        : (n.payload as ReplyToCommentPayload).commentId;
    return `${base}#comment-${commentId}`;
  }
  // Unknown type — `notifications.type` is free-form text, so a future
  // writer can ship a type this component has never seen. Land on the
  // listing itself instead of falling through to the old catch-all
  // comment-anchor branch, which read a nonexistent commentId and
  // produced "#comment-undefined".
  return base;
}

// Exported for unit testing (see __tests__/notifications-tab.test.ts)
// — not used outside this module otherwise.
export function buildMessage(n: Row): string {
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
    default:
      // Unknown type — see buildHref for why this is reachable at
      // runtime despite the exhaustive-looking switch.
      return "sent you a notification";
  }
}

function pickSnippet(n: Row): string | null {
  if (n.type === "purchase_on_listing" || n.type === "refund_on_listing") {
    const p = n.payload as
      | PurchaseOnListingPayload
      | RefundOnListingPayload;
    // Refunds render as negative so the inbox glance matches Stripe.
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
