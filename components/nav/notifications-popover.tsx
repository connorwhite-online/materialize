"use client";

import { useCallback, useState, useTransition, type CSSProperties } from "react";
import { Bell } from "@/components/icons/bell";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NotificationItem } from "@/components/notifications/notification-item";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import {
  listMyNotifications,
  markAllNotificationsRead,
  type NotificationListItem,
} from "@/app/actions/notifications";
import {
  type NotificationRow,
} from "@/lib/notifications/inbox";
import { cn } from "@/lib/utils";

function toRow(item: NotificationListItem): NotificationRow {
  return {
    id: item.id,
    type: item.type,
    payload: item.payload,
    readAt: item.readAt ? new Date(item.readAt) : null,
    createdAt: new Date(item.createdAt),
  };
}

interface NotificationsPopoverProps {
  initialUnreadCount: number;
  /** Extra classes on the bell trigger button. */
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  /** Position of the unread pip on the trigger. */
  dotClassName?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

/**
 * Bell that opens a pull-down of the notification stream. Fetches on
 * open so the layout doesn't pay for the inbox on every page, and
 * marks-all-read stays a deliberate click rather than a side effect
 * of peeking.
 */
export function NotificationsPopover({
  initialUnreadCount,
  triggerClassName,
  triggerStyle,
  dotClassName = "absolute right-2.5 top-2.5 h-2 w-2 rounded-[999px] bg-primary ring-2 ring-background",
  side = "bottom",
  align = "end",
}: NotificationsPopoverProps) {
  const unreadCount = useUnreadCount(initialUnreadCount, true);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const [marking, startMark] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startLoad(async () => {
      const result = await listMyNotifications();
      if ("error" in result) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.items.map(toRow));
    });
  }, []);

  const unreadInList = items?.filter((r) => !r.readAt).length ?? 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        className={cn("relative cursor-pointer", triggerClassName)}
        style={triggerStyle}
      >
        <Bell size={20} className="size-5 text-neutral-900 dark:text-neutral-100" />
        {unreadCount > 0 && <span className={dotClassName} />}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={10}
        className="flex w-[min(24rem,calc(100vw-1.5rem))] flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <PopoverTitle>Notifications</PopoverTitle>
          {unreadInList > 0 && (
            <button
              type="button"
              disabled={marking}
              onClick={() =>
                startMark(async () => {
                  await markAllNotificationsRead();
                  setItems((prev) =>
                    prev
                      ? prev.map((r) =>
                          r.readAt ? r : { ...r, readAt: new Date() }
                        )
                      : prev
                  );
                })
              }
              className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {marking ? "Marking…" : "Mark all read"}
            </button>
          )}
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {items === null && !error && <NotificationListSkeleton />}
          {error && (
            <p className="px-3 py-8 text-center text-sm text-destructive">
              {error}
            </p>
          )}
          {items && items.length === 0 && !error && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet. Activity on your listings will land
              here.
            </p>
          )}
          {items && items.length > 0 && (
            <div className="divide-y divide-border/60 py-1">
              {items.map((row) => (
                <NotificationItem
                  key={row.id}
                  row={row}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SKELETON_ROWS = [
  { title: "w-3/4", meta: "w-1/2" },
  { title: "w-2/3", meta: "w-2/5" },
  { title: "w-4/5", meta: "w-1/3" },
] as const;

function NotificationListSkeleton() {
  return (
    <div
      className="divide-y divide-border/60 py-1"
      aria-busy="true"
      aria-label="Loading notifications"
    >
      {SKELETON_ROWS.map((row, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Skeleton className={cn("h-3", row.title)} />
            <Skeleton className={cn("h-2.5", row.meta)} />
          </div>
        </div>
      ))}
    </div>
  );
}
