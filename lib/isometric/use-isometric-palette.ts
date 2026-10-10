"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  BACKDROP_INK,
  readIsometricPalette,
  type IsometricInk,
  type IsometricPalette,
} from "./palette";

/**
 * The page's isometric palette, re-read when the theme flips (class or
 * data attribute on <html>) or the OS scheme changes. `null` until the
 * host element mounts.
 */
export function useIsometricPalette(
  host: RefObject<HTMLElement | null>,
  ink: IsometricInk = BACKDROP_INK
): IsometricPalette | null {
  const [palette, setPalette] = useState<IsometricPalette | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const read = () => setPalette(readIsometricPalette(el, ink));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", read);
    };
  }, [host, ink]);

  return palette;
}
