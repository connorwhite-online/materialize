"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MetaballLoader } from "@/components/ui/metaball-loader";

/**
 * Global page-transition loader overlay.
 *
 * Only surfaces the metaball once a route transition has genuinely stalled.
 * Most in-app navigations (prefetched routes, cached segments) commit well
 * under {@link SHOW_DELAY_MS}, so the overlay stays hidden and there's no
 * jarring quarter-second flash on fast transitions.
 *
 * The App Router exposes no global "navigation started" event, so we detect
 * the two ways an in-app navigation begins — a click on an internal `<a>` and
 * browser back/forward (popstate) — arm a delayed reveal, and cancel it the
 * moment the destination commits (usePathname changes). If the delay elapses
 * first, the transition is genuinely slow and the loader fades in until the
 * new route arrives.
 */

// Only reveal the loader once a path transition has been in flight this long.
const SHOW_DELAY_MS = 1000;
// Failsafe cap so an aborted navigation (no pathname change) can't strand the
// overlay on screen.
const MAX_VISIBLE_MS = 15000;

export function PageTransitionLoader() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  // The destination committed (pathname changed) — stop waiting and hide.
  // Also runs on first mount as a harmless reset.
  useEffect(() => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    showTimerRef.current = undefined;
    hideTimerRef.current = undefined;
    setIsVisible(false);
  }, [pathname]);

  useEffect(() => {
    const arm = () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      showTimerRef.current = setTimeout(() => {
        setIsVisible(true);
        // Auto-dismiss failsafe in case the navigation never commits.
        hideTimerRef.current = setTimeout(
          () => setIsVisible(false),
          MAX_VISIBLE_MS
        );
      }, SHOW_DELAY_MS);
    };

    const onClick = (e: MouseEvent) => {
      // Ignore anything that won't be an in-app left-click navigation:
      // already-handled clicks, non-primary buttons, and modified clicks
      // (open-in-new-tab / download).
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      // Same-origin path changes only. Skip external links, in-page hash
      // jumps, and query-only updates (filters, sort) — the latter don't
      // change usePathname, so we'd have no completion signal to hide on.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      arm();
    };

    const onPopState = () => arm();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm transition-opacity duration-300 pointer-events-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden={!isVisible}
    >
      <div className="text-foreground">
        <MetaballLoader size={64} count={5} spin={4.5} breath={1.8} />
      </div>
    </div>
  );
}
