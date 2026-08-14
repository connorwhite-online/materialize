"use client";

import { useSyncExternalStore } from "react";

/** Pixels of scroll before the desktop wordmark collapses to the mark. */
export const SCROLLED_THRESHOLD_PX = 24;

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * True once the window has scrolled past `threshold`. SSR and the
 * first client paint report `false` so the expanded wordmark is the
 * default; a mid-page refresh snaps to collapsed in the same frame
 * via `useSyncExternalStore`.
 */
export function useScrolled(threshold = SCROLLED_THRESHOLD_PX): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY > threshold,
    () => false
  );
}
