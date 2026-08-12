"use client";

import { useEffect, useState } from "react";

/** How often the badge re-checks while the tab is visible. */
const POLL_INTERVAL_MS = 90_000;

/**
 * Unread-notification count with the same polling contract as the old
 * avatar dot: `/api/notifications/unread-count` every POLL_INTERVAL_MS,
 * paused while the tab is hidden, refreshed immediately on becoming
 * visible. Shared by the desktop and mobile bell popovers.
 *
 * Pass `enabled: false` for anon visitors so we don't hit the endpoint.
 */
export function useUnreadCount(
  initialUnreadCount: number,
  enabled = true
): number {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  useEffect(() => {
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
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
  }, [enabled]);

  return unreadCount;
}
