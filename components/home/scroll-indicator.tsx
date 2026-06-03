"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { STAGE_COUNT } from "@/components/home/scene/constants";

// Time the active dot takes to fill before auto-advancing to the next
// section. Resets/stops once the visitor scrolls themselves.
const DURATION_MS = 4500;
const ADVANCE_KEYS = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];

/**
 * Apple-style scroll indicator: a vertical capsule of one dot per
 * section. The active dot fills like a timer and, on completion,
 * smooth-scrolls to the next section — until the visitor takes over by
 * scrolling/clicking, after which it becomes a passive section pager.
 * Dots are also clickable to jump to a section.
 */
export function ScrollIndicator() {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const fillRef = useRef<HTMLSpanElement | null>(null);

  const autoRef = useRef(true);
  const progRef = useRef(0);
  const programmaticRef = useRef(false);
  const sectionsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const collect = () => {
      sectionsRef.current = Array.from(
        document.querySelectorAll<HTMLElement>("[data-home-section]")
      );
    };
    collect();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      autoRef.current = false;
    }

    const currentIndex = () => {
      const mid = window.scrollY + window.innerHeight / 2;
      let idx = 0;
      sectionsRef.current.forEach((el, i) => {
        if (el.offsetTop <= mid) idx = i;
      });
      return idx;
    };

    const syncActive = () => {
      const idx = currentIndex();
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
      }
    };

    // Any direct input means "I've got it" — stop auto-advancing.
    const takeOver = () => {
      if (programmaticRef.current) return;
      autoRef.current = false;
      progRef.current = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (ADVANCE_KEYS.includes(e.key)) takeOver();
    };

    window.addEventListener("scroll", syncActive, { passive: true });
    window.addEventListener("wheel", takeOver, { passive: true });
    window.addEventListener("touchmove", takeOver, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", collect);

    let raf = 0;
    let lastTs = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const dt = lastTs ? ts - lastTs : 16;
      lastTs = ts;

      const a = activeRef.current;
      const last = sectionsRef.current.length - 1;

      if (!autoRef.current || a >= last) {
        // Passive pager: active dot reads solid.
        progRef.current = 0;
        if (fillRef.current) fillRef.current.style.height = "100%";
        return;
      }

      progRef.current += dt / DURATION_MS;
      if (progRef.current >= 1) {
        progRef.current = 0;
        const next = sectionsRef.current[a + 1];
        if (next) {
          programmaticRef.current = true;
          window.scrollTo({ top: next.offsetTop, behavior: "smooth" });
          window.setTimeout(() => {
            programmaticRef.current = false;
          }, 900);
        }
      }
      if (fillRef.current) {
        fillRef.current.style.height = `${Math.min(1, progRef.current) * 100}%`;
      }
    };
    raf = requestAnimationFrame(tick);

    syncActive();

    return () => {
      window.removeEventListener("scroll", syncActive);
      window.removeEventListener("wheel", takeOver);
      window.removeEventListener("touchmove", takeOver);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", collect);
      cancelAnimationFrame(raf);
    };
  }, []);

  const goTo = (i: number) => {
    autoRef.current = false;
    progRef.current = 0;
    const el = sectionsRef.current[i];
    if (el) {
      programmaticRef.current = true;
      window.scrollTo({ top: el.offsetTop, behavior: "smooth" });
      window.setTimeout(() => {
        programmaticRef.current = false;
      }, 900);
    }
  };

  return (
    <div
      className="flex flex-col items-center gap-2 rounded-full border border-border/40 bg-background/25 px-1.5 py-2 backdrop-blur-sm"
      role="navigation"
      aria-label="Section progress"
    >
      {Array.from({ length: STAGE_COUNT }).map((_, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to section ${i + 1}`}
            aria-current={isActive ? "true" : undefined}
            className="flex h-3 w-3 items-center justify-center"
          >
            <span
              className={cn(
                "relative block overflow-hidden rounded-full transition-all duration-300",
                isActive
                  ? "h-2.5 w-2.5 bg-muted-foreground/25"
                  : "h-1.5 w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
            >
              {isActive && (
                <span
                  ref={fillRef}
                  className="absolute inset-x-0 bottom-0 bg-foreground"
                  style={{ height: "0%" }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
