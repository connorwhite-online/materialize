"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MaterialCarousel } from "@/components/home/material-carousel";
import { useLanding } from "./landing-context";
import {
  INTRO_SEQUENCE,
  INTRO_STEP_MS,
  LANDING_MATERIALS,
} from "./landing-materials";

const SWIPE_THRESHOLD = 30;
const VERTICAL_CANCEL = 40;

/**
 * First screen of the anon landing. Owns the horizontal swipe that
 * drives the material carousel (the canvas behind is pointer-events:
 * none) and the load-time intro that whooshes through every family.
 */
export function LandingHero({ children }: { children: ReactNode }) {
  const { material, select, tensionRef } = useLanding();
  const ref = useRef<HTMLElement>(null);
  const materialRef = useRef(material);
  useEffect(() => {
    materialRef.current = material;
  }, [material]);

  useIntro();

  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    peak: 0,
    cancelled: false,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("a,button")) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastT: performance.now(),
      peak: 0,
      cancelled: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || d.cancelled) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > VERTICAL_CANCEL && Math.abs(dy) > Math.abs(dx)) {
      d.cancelled = true;
      tensionRef.current = 0;
      return;
    }
    const now = performance.now();
    const v = Math.min(
      1,
      Math.abs(((e.clientX - d.lastX) / Math.max(1, now - d.lastT)) * 20),
    );
    d.peak = Math.max(d.peak, v);
    d.lastX = e.clientX;
    d.lastT = now;
    // tanh asymptote = resistance that grows as the finger pulls further.
    tensionRef.current = Math.tanh(dx / 220);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    tensionRef.current = 0;
    if (d.cancelled) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      const step = dx > 0 ? -1 : 1;
      select(materialRef.current + step, step, 0.3 + d.peak * 1.2);
    }
  };

  // Non-passive touchmove so a horizontal drag doesn't trigger iOS
  // edge-swipe-back; vertical scrolling is left alone (touch-action).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    const start = (e: TouchEvent) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) e.preventDefault();
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
    };
  }, []);

  return (
    <section
      ref={ref}
      data-landing-section
      className="relative z-10 flex h-svh w-full cursor-grab flex-col select-none active:cursor-grabbing"
      style={{ touchAction: "pan-y", overscrollBehaviorX: "contain" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {children}
    </section>
  );
}

/** Runs the whoosh once the enclosure is on screen. */
function useIntro() {
  const { ready, select, setWord } = useLanding();
  const reduced = useReducedMotion();
  const ran = useRef(false);
  useEffect(() => {
    if (!ready || ran.current || reduced) return;
    // Someone reloading mid-page shouldn't get a hero show they can't see.
    if (window.scrollY > window.innerHeight / 2) return;
    ran.current = true;
    const timers = INTRO_SEQUENCE.map((step, i) =>
      window.setTimeout(
        () => {
          setWord(step.word);
          // Every step is a "next": the spray always flies the same way,
          // so the sequence reads as one continuous whoosh.
          if (i > 0) select(step.material, 1, 0.9);
        },
        250 + i * INTRO_STEP_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [ready, reduced, select, setWord]);
}

/** "Print ___," — the blank cycles during the intro, then rests on "anything". */
export function HeroWord() {
  const { word } = useLanding();
  return (
    <span className="relative inline-grid">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={word}
          initial={{ opacity: 0, x: 18, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -18, filter: "blur(6px)" }}
          transition={{ duration: 0.18, ease: [0.22, 0.9, 0.28, 1] }}
          className="inline-block"
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function HeroCarousel() {
  const { material, select } = useLanding();
  return (
    <div className="w-full max-w-[420px] -ml-2">
      <MaterialCarousel
        materials={LANDING_MATERIALS}
        selectedIndex={material}
        onSelect={select}
      />
    </div>
  );
}
