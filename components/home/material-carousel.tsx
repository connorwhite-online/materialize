"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { MaterialMetadata } from "@/lib/materials/data";
import { cn } from "@/lib/utils";

interface MaterialCarouselProps {
  materials: MaterialMetadata[];
  selectedIndex: number;
  onSelect: (index: number, direction: number) => void;
}

/**
 * Display-only carousel of material names.
 * Scroll is driven by the parent HeroShowcase via the forwarded ref.
 * No native scroll — overflow is hidden and parent imperatively sets scrollLeft.
 */
export const MaterialCarousel = forwardRef<HTMLDivElement, MaterialCarouselProps>(
  function MaterialCarousel({ materials, selectedIndex, onSelect }, ref) {
    const trackRef = useRef<HTMLDivElement>(null);

    // Forward the internal ref to the parent
    useImperativeHandle(ref, () => trackRef.current as HTMLDivElement);

    // Scroll to keep selected item centered when selectedIndex changes
    useEffect(() => {
      const track = trackRef.current;
      if (!track) return;
      const item = track.children[selectedIndex] as HTMLElement | undefined;
      if (!item) return;

      const trackCenter = track.offsetWidth / 2;
      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const targetScroll = itemCenter - trackCenter;

      if (Math.abs(track.scrollLeft - targetScroll) < 1) return;
      track.scrollTo({ left: targetScroll, behavior: "smooth" });
    }, [selectedIndex]);

    return (
      <div className="relative w-full max-w-[420px] mx-auto">
        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-background to-transparent" />

        <div
          ref={trackRef}
          className="flex items-center gap-6 overflow-x-hidden px-[50%] py-2 select-none"
        >
          {materials.map((material, i) => {
            const isActive = i === selectedIndex;
            return (
              <button
                key={material.id}
                type="button"
                onClick={() => {
                  if (i !== selectedIndex) {
                    onSelect(i, i > selectedIndex ? 1 : -1);
                  }
                }}
                className={cn(
                  "shrink-0 whitespace-nowrap text-sm font-medium leading-none transition-colors duration-200",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                )}
              >
                {material.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);
