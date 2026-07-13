"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { cn } from "@/lib/utils";

interface Props {
  /** Image URLs in display order. The first is the cover. */
  images: string[];
  alt?: string;
  /**
   * 'sm' (default) — dot indicators only.
   * 'lg' — adds prev/next chevrons in matching pills on either side
   *        of the indicator pill, for cards big enough to absorb the
   *        extra controls without crowding.
   */
  size?: "sm" | "lg";
  className?: string;
}

/**
 * Snap-scrolling image carousel for file/project cards. Images
 * stack horizontally with `snap-x snap-mandatory` so swipe / drag /
 * wheel naturally lock to one image at a time. A bottom-centered
 * pill renders dot indicators (active dot is double width with a
 * smooth width transition); the `lg` variant flanks the pill with
 * chevron pills for click-to-page navigation on bigger cards.
 *
 * No carousel chrome shows when the array has only one image — the
 * single image just fills the slot.
 */
export function CardImageCarousel({
  images,
  alt = "",
  size = "sm",
  className,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Track the active image by computing scrollLeft / clientWidth on
  // each scroll tick. Cheap, no IntersectionObserver needed since the
  // scroller is the same width as each image (snap mandatory pins
  // exactly one in view).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || images.length <= 1) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const idx = Math.round(el.scrollLeft / w);
      setActiveIndex(Math.max(0, Math.min(idx, images.length - 1)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [images.length]);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  if (images.length === 0) return null;

  // next.config.ts widens `images.localPatterns` for /api/thumbnails/**
  // so both `?photoId=…` and bare-cover URLs satisfy the optimizer's
  // src allowlist — no per-instance `unoptimized` escape hatch needed
  // for the carousel anymore.
  const carouselSizes =
    size === "lg"
      ? "(min-width: 1024px) 50vw, 100vw"
      : "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

  // Single-image fast path — render plainly without the scroll
  // gymnastics or controls.
  if (images.length === 1) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden", className)}>
        <Image
          src={images[0]}
          alt={alt}
          fill
          sizes={carouselSizes}
          // The `lg` variant is the detail-page hero — eager-load its
          // cover so it doesn't lazy-pop on a cold (e.g. anon) first
          // visit, where it isn't already in the browser cache.
          priority={size === "lg"}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div
        ref={scrollerRef}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          <div
            key={i}
            className="relative h-full w-full shrink-0 snap-start snap-always"
          >
            <Image
              src={src}
              alt={alt}
              fill
              sizes={carouselSizes}
              // Eager-load only the hero cover (first slide of the `lg`
              // variant) so it's painted immediately on a cold/anon
              // first visit instead of lazy-popping in.
              priority={size === "lg" && i === 0}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {/* Indicator + chevron stack — pointer-events-none on the
          outer wrapper so swipes pass through to the scroller; only
          the controls themselves are interactive. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 px-2">
        {size === "lg" && (
          <ChevronPill
            direction="left"
            disabled={activeIndex === 0}
            onClick={() => goTo(Math.max(0, activeIndex - 1))}
          />
        )}
        <div className="pointer-events-auto flex h-7 items-center gap-1 rounded-full bg-black/45 px-2.5 backdrop-blur-md">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Image ${i + 1}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(i);
              }}
              // Fixed-width slot so the active dot's width animation
              // doesn't reflow siblings and jitter the centered pill.
              className="flex h-2 w-4 shrink-0 cursor-pointer items-center justify-center"
            >
              <span
                aria-hidden
                className={cn(
                  "block h-2 rounded-full bg-white transition-[width,opacity] duration-300 ease-out",
                  i === activeIndex ? "w-4" : "w-2 opacity-60"
                )}
              />
            </button>
          ))}
        </div>
        {size === "lg" && (
          <ChevronPill
            direction="right"
            disabled={activeIndex === images.length - 1}
            onClick={() =>
              goTo(Math.min(images.length - 1, activeIndex + 1))
            }
          />
        )}
      </div>
    </div>
  );
}

function ChevronPill({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      aria-label={direction === "left" ? "Previous image" : "Next image"}
      className={cn(
        "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors",
        "hover:bg-black/55 disabled:opacity-40 disabled:cursor-not-allowed",
        "cursor-pointer"
      )}
    >
      {direction === "left" ? (
        <ChevronLeft size={14} className="-translate-x-px" />
      ) : (
        <ChevronRight size={14} className="translate-x-px" />
      )}
    </button>
  );
}
