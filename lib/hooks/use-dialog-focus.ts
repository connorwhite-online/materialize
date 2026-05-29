"use client";

import { useEffect, type RefObject } from "react";

/**
 * Focus management for hand-rolled modal dialogs (the photo + circuit
 * lightboxes). Radix's Dialog gives this for free, but these overlays
 * are custom, so without it keyboard / screen-reader users stay on the
 * page behind the modal and can Tab into obscured content. This hook:
 *
 *   1. On open, remembers whatever had focus and moves focus into the
 *      dialog container.
 *   2. While open, traps Tab / Shift+Tab within the dialog's focusable
 *      elements so focus can't escape to the page behind.
 *   3. On close (unmount), restores focus to the element that opened
 *      the dialog.
 *
 * The container must be rendered with `tabIndex={-1}` so step 1 can
 * focus it before any button is reachable.
 *
 * Note: focus that crosses into an embedded iframe (Wokwi / KiCanvas)
 * can't be trapped from here — that's an inherent cross-frame limit.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focusing the container (tabIndex=-1) anchors Tab inside and lets
    // screen readers announce the dialog's role + label.
    node.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === node) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref]);
}
