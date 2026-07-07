"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pin a `position: fixed` element above the on-screen (soft) keyboard on iOS
 * Safari using the VisualViewport API.
 *
 * Without this, a fixed element anchored to `bottom` sits at the bottom of the
 * *layout* viewport — which on iOS hides behind the keyboard once it opens, and
 * triggers a document auto-scroll trying to bring the focused input into view.
 * We rewrite the element's `bottom` to the keyboard's height (the overlap
 * between the layout and visual viewports) plus a base offset.
 *
 * Extracted from the home bottom bar (MTR-211) so the studio composer and any
 * future fixed input bar share one implementation. Pairs with
 * `viewport.interactiveWidget = "overlays-content"` in `app/layout.tsx`.
 *
 * @param ref          the fixed element whose `bottom` is rewritten
 * @param baseOffsetPx the resting bottom offset in px (e.g. 16 for `bottom-4`,
 *                     0 for `bottom-0`) — kept when no keyboard is open
 */
export function useKeyboardStickyBottom(
  ref: RefObject<HTMLElement | null>,
  baseOffsetPx = 0
): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const updateOffset = () => {
      const el = ref.current;
      if (!el) return;
      // Distance between the bottom of the layout viewport and the bottom of
      // the visual viewport — i.e. the keyboard height (plus any iOS chrome
      // overlapping it). Clamped so the element never drops below its rest.
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      el.style.bottom = `${Math.max(baseOffsetPx, overlap + baseOffsetPx)}px`;
    };

    updateOffset();
    vv.addEventListener("resize", updateOffset);
    vv.addEventListener("scroll", updateOffset);
    return () => {
      vv.removeEventListener("resize", updateOffset);
      vv.removeEventListener("scroll", updateOffset);
    };
  }, [ref, baseOffsetPx]);
}
