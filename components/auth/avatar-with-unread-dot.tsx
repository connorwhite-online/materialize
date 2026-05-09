"use client";

import { useState, useEffect } from "react";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";

interface Props {
  /** Initial unread count from the server render. */
  initialUnreadCount: number;
  seed: string;
  imageUrl: string | null;
  displayName: string | null;
  className?: string;
}

/**
 * UserAvatar with a small unread-notification dot in the top-right.
 * Subscribes to /api/notifications/stream so the dot reflects new
 * notifications in real time. Same SSE transport as the prior bell;
 * we just listen for snapshots and read `unreadCount` off them.
 *
 * The connection is closed while the tab is hidden so a backgrounded
 * tab doesn't hold an open stream — matches the bell's prior pattern.
 */
export function AvatarWithUnreadDot({
  initialUnreadCount,
  seed,
  imageUrl,
  displayName,
  className,
}: Props) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  useEffect(() => {
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    let es: EventSource | null = null;
    let cancelled = false;

    const open = () => {
      if (cancelled || es) return;
      if (typeof document !== "undefined" && document.hidden) return;
      es = new EventSource("/api/notifications/stream", {
        withCredentials: true,
      });
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { unreadCount: number };
          if (typeof data.unreadCount === "number") {
            setUnreadCount(data.unreadCount);
          }
        } catch {
          // Malformed frame — skip; next snapshot overrides.
        }
      };
    };

    const close = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) close();
      else open();
    };

    document.addEventListener("visibilitychange", onVisibility);
    open();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, []);

  return (
    <div className="relative shrink-0">
      <UserAvatar
        seed={seed}
        imageUrl={imageUrl}
        displayName={displayName}
        className={className}
      />
      {unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread notification${
            unreadCount === 1 ? "" : "s"
          }`}
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
          )}
        />
      )}
    </div>
  );
}
