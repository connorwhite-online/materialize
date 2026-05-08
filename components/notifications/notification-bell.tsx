"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { BellIcon } from "lucide-react";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils/time";
import { cn } from "@/lib/utils";
import {
  markNotificationRead,
  markNotificationsRead,
  markAllNotificationsRead,
} from "@/app/actions/notifications";
import type {
  CommentOnListingPayload,
  MakeOnFilePayload,
  ReplyToCommentPayload,
} from "@/lib/notifications/types";

export type NotificationItem = {
  id: string;
  type: "comment_on_listing" | "reply_to_comment" | "make_on_file";
  payload:
    | CommentOnListingPayload
    | ReplyToCommentPayload
    | MakeOnFilePayload;
  readAt: Date | string | null;
  createdAt: Date | string;
};

interface Props {
  /** Total unread count across the inbox (uncapped). Drives the badge. */
  unreadCount: number;
  /** Most recent N items, newest first. The dropdown only shows these. */
  recent: NotificationItem[];
  /** Optional className for placement (e.g. sidebar gives full width). */
  className?: string;
}

const VISIBLE_LIMIT = 20;

/**
 * Notification bell with dropdown.
 *
 * The bell button is always shown for authed users (no count badge
 * when zero, matching how notification inboxes behave on most apps —
 * users want to know the bell is there even before they have any).
 *
 * Items are pre-rendered server-side via `recent`; this avoids a
 * round-trip on dropdown open. Mark-read happens lazily: when the
 * user opens the dropdown we batch-mark all currently-visible unread
 * ids in one server action call. Click-through to a specific item
 * also marks it read individually before navigating, in case the
 * server action above failed (e.g. cold-start blip).
 */
export function NotificationBell({ unreadCount, recent, className }: Props) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  // Track items that were unread at *open time* and therefore got
  // batch-marked. We don't want to re-mark on every popover toggle.
  const batchMarkedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    const unseen = recent
      .filter((n) => !n.readAt && !batchMarkedRef.current.has(n.id))
      .map((n) => n.id);
    if (unseen.length === 0) return;
    for (const id of unseen) batchMarkedRef.current.add(id);
    startTransition(() => {
      markNotificationsRead(unseen).then(() => router.refresh());
    });
  }, [open, recent, router]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "relative cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground",
          className
        )}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="depth-surface w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl bg-card text-card-foreground ring-1 ring-foreground/10 outline-none">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    startTransition(() => {
                      markAllNotificationsRead().then(() => router.refresh());
                    });
                  }}
                >
                  Mark all read
                </Button>
              )}
            </div>
            {recent.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                {recent.slice(0, VISIBLE_LIMIT).map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({
  notification,
  onClick,
}: {
  notification: NotificationItem;
  onClick: () => void;
}) {
  const router = useRouter();
  const { actor, listing } = notification.payload;
  const href = buildHref(notification);
  const message = buildMessage(notification);
  const snippet = "snippet" in notification.payload
    ? notification.payload.snippet
    : null;
  const isUnread = !notification.readAt;

  return (
    <Link
      href={href}
      onClick={(e) => {
        // Mark this individual row read before navigating, in case the
        // batch-on-open call missed it. Navigation is allowed to
        // proceed normally; the action runs in a transition.
        if (isUnread) {
          e.preventDefault();
          markNotificationRead(notification.id).then(() => {
            router.push(href);
            router.refresh();
          });
        }
        onClick();
      }}
      className={cn(
        "flex items-start gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40",
        isUnread && "bg-primary/5"
      )}
    >
      <UserAvatar
        seed={actor.username || actor.id}
        imageUrl={actor.avatarUrl}
        displayName={actor.displayName || actor.username || "Anonymous"}
        className="h-8 w-8 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="font-medium truncate">
            {actor.displayName || actor.username || "Anonymous"}
          </span>
          <span className="text-muted-foreground">{message}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {timeAgo(notification.createdAt)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          on <span className="font-medium">{listing.name}</span>
        </div>
        {snippet && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
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

function buildHref(n: NotificationItem): string {
  const { listing } = n.payload;
  const base =
    listing.kind === "file"
      ? `/files/${listing.slug}`
      : `/projects/${listing.slug}`;
  if (n.type === "make_on_file") {
    return `${base}#make-${(n.payload as MakeOnFilePayload).makeId}`;
  }
  // For comments + replies, anchor to the comment id so the listing
  // page can scroll to it (fragment is harmless if the page doesn't
  // expose a matching anchor yet).
  const commentId =
    n.type === "comment_on_listing"
      ? (n.payload as CommentOnListingPayload).commentId
      : (n.payload as ReplyToCommentPayload).commentId;
  return `${base}#comment-${commentId}`;
}

function buildMessage(n: NotificationItem): string {
  switch (n.type) {
    case "comment_on_listing":
      return "commented";
    case "reply_to_comment":
      return "replied to your comment";
    case "make_on_file":
      return "shared a make";
  }
}
