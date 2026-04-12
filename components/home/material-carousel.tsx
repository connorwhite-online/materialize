"use client";

import { useRef, useEffect } from "react";
import type { MaterialMetadata } from "@/lib/materials/data";
import { cn } from "@/lib/utils";

interface MaterialCarouselProps {
  materials: MaterialMetadata[];
  selectedIndex: number;
  onSelect: (index: number, direction: number) => void;
}

/**
 * Horizontal snap-scroll carousel of material names.
 * Native CSS scroll-snap provides the magnetic snap feel.
 * Scroll end → detect which item is centered and update selection.
 */
export function MaterialCarousel({
  materials,
  selectedIndex,
  onSelect,
}: MaterialCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to keep selected item centered (smooth)
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const item = track.children[selectedIndex] as HTMLElement | undefined;
    if (!item) return;

    const trackCenter = track.offsetWidth / 2;
    const itemCenter = item.offsetLeft + item.offsetWidth / 2;
    const targetScroll = itemCenter - trackCenter;

    if (Math.abs(track.scrollLeft - targetScroll) < 1) return;

    isProgrammaticScroll.current = true;
    track.scrollTo({ left: targetScroll, behavior: "smooth" });

    setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 500);
  }, [selectedIndex]);

  const handleScroll = () => {
    if (isProgrammaticScroll.current) return;
    const track = trackRef.current;
    if (!track) return;

    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      const trackCenter = track.scrollLeft + track.offsetWidth / 2;
      let closestIndex = 0;
      let closestDistance = Infinity;
      for (let i = 0; i < track.children.length; i++) {
        const item = track.children[i] as HTMLElement;
        const itemCenter = item.offsetLeft + item.offsetWidth / 2;
        const distance = Math.abs(trackCenter - itemCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      }

      if (closestIndex !== selectedIndex) {
        const direction = closestIndex > selectedIndex ? 1 : -1;
        onSelect(closestIndex, direction);
      }
    }, 100);
  };

  return (
    <div className="relative w-full">
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />

      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex items-center gap-6 overflow-x-auto px-[50%] py-2 select-none snap-x snap-mandatory"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
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
                "shrink-0 snap-center whitespace-nowrap text-sm transition-all duration-200",
                isActive
                  ? "text-foreground font-medium text-base"
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
