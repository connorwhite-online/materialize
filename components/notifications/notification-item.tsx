"use client";

import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/auth/user-avatar";
import { timeAgo } from "@/lib/utils/time";
import { cn } from "@/lib/utils";
import { markNotificationRead } from "@/app/actions/notifications";
import {
  buildHref,
  buildMessage,
  getListing,
  pickSnippet,
  type NotificationRow,
} from "@/lib/notifications/inbox";

/**
 * One inbox row. Marks the notification read, then navigates to the
 * source. Used by the bell popover (and kept compact so a scrollable
 * list of ~50 still fits in a pull-down).
 */
export function NotificationItem({
  row,
  onNavigate,
}: {
  row: NotificationRow;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { actor } = row.payload;
  const listing = getListing(row);
  const href = buildHref(row);
  const message = buildMessage(row);
  const snippet = pickSnippet(row);
  const isUnread = !row.readAt;
  const name = actor.displayName || actor.username || "Anonymous";

  return (
    <button
      type="button"
      onClick={() => {
        if (isUnread) void markNotificationRead(row.id);
        onNavigate?.();
        router.push(href);
      }}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
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
          <span className="truncate text-muted-foreground">{message}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {timeAgo(row.createdAt)}
          </span>
        </div>
        {listing && (
          <div className="truncate text-xs text-muted-foreground">
            on <span className="font-medium">{listing.name}</span>
          </div>
        )}
        {snippet && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{snippet}</p>
        )}
      </div>
      {isUnread && (
        <span
          className="mt-2 size-2 shrink-0 rounded-full bg-primary"
          aria-label="Unread"
        />
      )}
    </button>
  );
}
