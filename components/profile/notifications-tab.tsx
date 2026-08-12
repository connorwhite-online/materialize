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
import type { NotificationType } from "@/lib/notifications/types";
import {
  buildHref,
  buildMessage,
  getListing,
  hasUsableActor,
  pickSnippet,
  type NotificationPayload,
  type NotificationRow,
} from "@/lib/notifications/inbox";

const INBOX_LIMIT = 100;

// Re-exported for unit tests that import from this module
// (see __tests__/notifications-tab.test.ts).
export type Row = NotificationRow;
export { buildHref, buildMessage, hasUsableActor };

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
      payload: r.payload as NotificationPayload,
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

function NotificationRow({ row }: { row: NotificationRow }) {
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
