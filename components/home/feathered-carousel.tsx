"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const FEATHER_PX = 28;

/**
 * Horizontal scroller with edge fades that only appear when there's
 * content hidden past that edge. Shared by the authed-home carousels.
 */
export function FeatheredCarousel({
  children,
}: {
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { atStart, atEnd }
    );
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, children]);

  const leftPx = edges.atStart ? 0 : FEATHER_PX;
  const rightPx = edges.atEnd ? 0 : FEATHER_PX;
  const carouselMask = `linear-gradient(to right, transparent 0, #000 ${leftPx}px, #000 calc(100% - ${rightPx}px), transparent 100%)`;

  return (
    <div
      ref={scrollRef}
      // px/pt: overflow-x-auto forces overflow-y to auto too, which
      // would clip the 1px ring on cards flush with the scroller edge.
      className="flex gap-3 overflow-x-auto px-px pt-px pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maskImage: carouselMask,
        WebkitMaskImage: carouselMask,
      }}
    >
      {children}
    </div>
  );
}
