"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Where the text block "rests" (its top as a fraction of viewport
// height) when its section is snapped — copy sits near the top (pt-16).
const REST_TOP = 0.1;
// Falloff distances (fractions of viewport height) over which it
// dissolves out (scrolling up past rest) and in (rising from below).
const EXIT_RANGE = 0.34;
const ENTER_RANGE = 0.52;
const MAX_BLUR = 7;

/**
 * Dissolves its content in/out as the page scrolls: as the block leaves
 * its rest position it loses opacity, blurs, and scales down slightly,
 * layered on top of the natural scroll movement. Sharpest when the
 * section is snapped into place. SSR-safe (renders visible; the effect
 * only applies client-side) and respects prefers-reduced-motion.
 */
export function ScrollReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.opacity = "1";
      el.style.filter = "none";
      el.style.transform = "none";
      return;
    }

    el.style.willChange = "opacity, filter, transform";
    el.style.transformOrigin = "center top";

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = rect.top / vh; // 0 = top at viewport top
      const d = p - REST_TOP;
      const t =
        d <= 0
          ? Math.max(0, Math.min(1, 1 + d / EXIT_RANGE)) // scrolling up & out
          : Math.max(0, Math.min(1, 1 - d / ENTER_RANGE)); // rising in from below
      const s = t * t * (3 - 2 * t); // smoothstep

      el.style.opacity = String(s);
      el.style.filter = s > 0.999 ? "none" : `blur(${(1 - s) * MAX_BLUR}px)`;
      el.style.transform = `scale(${0.94 + 0.06 * s})`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
