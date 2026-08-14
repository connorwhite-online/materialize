"use client";

import { useEffect, useState } from "react";

/**
 * True once `window.scrollY` exceeds `thresholdPx`. The landing wordmark
 * uses this to collapse into the mark after the first nudge of scroll.
 *
 * Pass `enabled: false` to skip the listener (app chrome that never
 * shows the wordmark). The hook then stays `false`.
 */
export function useScrolledPast(thresholdPx: number, enabled = true): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const onScroll = () => {
      setPast(window.scrollY > thresholdPx);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [thresholdPx, enabled]);

  return past;
}
