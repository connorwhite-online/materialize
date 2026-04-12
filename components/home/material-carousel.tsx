"use client";

import { useRef, useState, useEffect } from "react";
import type { MaterialMetadata } from "@/lib/materials/data";
import { cn } from "@/lib/utils";

interface MaterialCarouselProps {
  materials: MaterialMetadata[];
  selectedIndex: number;
  onSelect: (index: number, direction: number) => void;
}

/**
 * Horizontal snap-scroll carousel of material names.
 * Active material is centered and larger; others fade to the sides.
 */
export function MaterialCarousel({
  materials,
  selectedIndex,
  onSelect,
}: MaterialCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, scrollLeft: 0 });

  // Scroll to keep selected item centered
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const item = track.children[selectedIndex] as HTMLElement | undefined;
    if (!item) return;

    const trackCenter = track.offsetWidth / 2;
    const itemCenter = item.offsetLeft + item.offsetWidth / 2;
    track.scrollTo({
      left: itemCenter - trackCenter,
      behavior: "smooth",
    });
  }, [selectedIndex]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const track = trackRef.current;
    if (!track) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, scrollLeft: track.scrollLeft };
    track.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const track = trackRef.current;
    if (!track) return;
    const delta = e.clientX - dragStart.current.x;
    track.scrollLeft = dragStart.current.scrollLeft - delta;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    const track = trackRef.current;
    if (!track) return;
    setDragging(false);
    track.releasePointerCapture(e.pointerId);

    // Find the item closest to the track center and select it
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
  };

  return (
    <div className="relative w-full">
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />

      <div
        ref={trackRef}
        className={cn(
          "flex items-center gap-6 overflow-x-auto px-[50%] py-2 scrollbar-none select-none",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ scrollbarWidth: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
                "shrink-0 whitespace-nowrap text-sm transition-all duration-200",
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
