"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Overlap (px) between the layout viewport and the (shrunken) visual viewport
 * — i.e. the height of whatever is covering the bottom of the screen, almost
 * always the on-screen keyboard. Shared by the sticky-bottom pin and the
 * `useKeyboardOpen` signal so both read the keyboard from one place (MTR-212).
 */
function keyboardOverlapPx(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

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
      // The keyboard height (plus any iOS chrome overlapping it), clamped so
      // the element never drops below its rest offset.
      const overlap = keyboardOverlapPx();
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

/**
 * The live bottom overlap in px — the keyboard's height — from the same
 * VisualViewport source as the pin and the open/closed signal.
 *
 * Where `useKeyboardStickyBottom` mutates one element's `bottom` imperatively,
 * this returns the number so a component can lay itself out around the
 * keyboard (e.g. `NativeSheet` pads its bottom AND shrinks its max height, so
 * a sheet with an input rides above the keyboard instead of under it). Returns
 * 0 during SSR and wherever VisualViewport is absent, which makes every
 * consumer a no-op on those platforms.
 */
export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setOverlap(keyboardOverlapPx());
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return overlap;
}

/**
 * `true` while the on-screen (soft) keyboard is open, detected from the same
 * VisualViewport overlap the sticky-bottom pin uses. Global surfaces (the
 * mobile bottom nav, MTR-212) read this to fade themselves out while a text
 * input has the keyboard up, rather than floating over the raised composer.
 *
 * A generous threshold (default 120px) keeps benign visual-viewport changes —
 * the iOS URL bar collapsing, a rubber-band scroll — from reading as a
 * keyboard. Returns `false` during SSR and where VisualViewport is absent.
 *
 * @param thresholdPx minimum bottom overlap (px) that counts as "keyboard open"
 */
export function useKeyboardOpen(thresholdPx = 120): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setOpen(keyboardOverlapPx() > thresholdPx);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [thresholdPx]);

  return open;
}
