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

/** How often the dot re-checks the unread count while the tab is visible. */
const POLL_INTERVAL_MS = 90_000;

/**
 * UserAvatar with a small unread-notification dot in the top-right.
 * Polls /api/notifications/unread-count every POLL_INTERVAL_MS so the
 * dot reflects new notifications without holding any persistent
 * connection.
 *
 * This replaced an SSE/LISTEN stream: that kept an open Postgres
 * connection per visible tab, preventing Neon from auto-suspending the
 * whole time anyone had the app open. Polling lets the DB sleep
 * between checks; the cost is up to one interval of badge latency.
 *
 * Polling is paused while the tab is hidden (no wasted requests on a
 * backgrounded tab) and fires once immediately on becoming visible so
 * a returning user sees a fresh count right away.
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
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/notifications/unread-count", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unreadCount?: number };
        if (!cancelled && typeof data.unreadCount === "number") {
          setUnreadCount(data.unreadCount);
        }
      } catch {
        // Transient network failure — the next tick retries.
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stop();
      } else {
        // Catch up immediately, then resume the interval.
        void refresh();
        start();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
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
