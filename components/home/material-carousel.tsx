"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { animate } from "motion/react";
import type { MaterialMetadata } from "@/lib/materials/preset-library";
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

    // Spring-animate scrollLeft when selectedIndex changes — gives
    // the carousel a small overshoot + settle instead of the linear
    // browser smooth-scroll. Stiffness/damping tuned for a snappy
    // pop with one subtle bounce. The animation is cancelled on
    // cleanup so a rapid sequence of swipes hands off cleanly.
    useEffect(() => {
      const track = trackRef.current;
      if (!track) return;
      const item = track.children[selectedIndex] as HTMLElement | undefined;
      if (!item) return;

      const trackCenter = track.offsetWidth / 2;
      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const targetScroll = itemCenter - trackCenter;

      if (Math.abs(track.scrollLeft - targetScroll) < 1) return;

      const controls = animate(track.scrollLeft, targetScroll, {
        type: "spring",
        stiffness: 1050,
        damping: 30,
        mass: 0.55,
        onUpdate: (latest) => {
          track.scrollLeft = latest;
        },
      });

      return () => controls.stop();
    }, [selectedIndex]);

    return (
      <div className="relative w-full max-w-[420px] mx-auto">
        {/* Edge fade via a mask (alpha only) — overlaying a colored
            `from-background` gradient used to leave a visible cream band
            because the page background is now a gradient behind the 3D
            scene, not a flat fill. A mask fades the items themselves and
            never tints the scene. */}
        <div
          ref={trackRef}
          className="flex items-center gap-10 overflow-x-hidden px-[50%] py-2 select-none"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
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
