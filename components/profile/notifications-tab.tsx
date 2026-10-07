import Link from "next/link";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { EmptyState } from "@/components/ui/page";
import { Bell } from "@/components/icons/bell";
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
      <EmptyState
        icon={<Bell />}
        title="You're all caught up"
        description="Activity on your listings and replies to your comments will land here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {unreadCount > 0
            ? `${unreadCount} unread · ${items.length} total`
            : `${items.length} total`}
        </p>
        {unreadCount > 0 && <NotificationsTabActions />}
      </div>
      {/* Unboxed rows (rulebook § Lists). Unread is the app-wide red dot plus a
          heavier name, not a tinted wash across the whole row. */}
      <ul className="-mx-3 flex flex-col">
        {items.map((row) => (
          <li key={row.id}>
            <NotificationRow row={row} />
          </li>
        ))}
      </ul>
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
      className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <UserAvatar
        seed={actor.username || actor.id}
        imageUrl={actor.avatarUrl}
        displayName={name}
        className="size-9 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 text-sm leading-5">
            <span className={cn(isUnread ? "font-semibold" : "font-medium")}>
              {name}
            </span>{" "}
            <span className="text-muted-foreground">{message}</span>
          </p>
          <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
            {timeAgo(row.createdAt)}
          </span>
        </div>
        {listing && (
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
            on <span className="text-foreground">{listing.name}</span>
          </p>
        )}
        {snippet && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
            {snippet}
          </p>
        )}
      </div>
      <span
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          isUnread ? "bg-destructive" : "bg-transparent"
        )}
        aria-label={isUnread ? "Unread" : undefined}
      />
    </Link>
  );
}
