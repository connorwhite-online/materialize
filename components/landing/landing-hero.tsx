"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Pause } from "@/components/icons/pause";
import { Play } from "@/components/icons/play";
import { cn } from "@/lib/utils";
import { STEPS, STEP_MS, useLanding } from "./landing-context";
import { INTRO_SEQUENCE, INTRO_STEP_MS } from "./landing-materials";

const SWIPE_THRESHOLD = 30;
const VERTICAL_CANCEL = 40;

/**
 * First screen of the anon landing — the whole story lives here, driven
 * by the stepper rather than by scrolling. Owns the horizontal swipe (the
 * canvas behind is pointer-events: none): on the first step it changes
 * the material; on the others it moves between steps. Also runs the
 * load-time intro that whooshes through every material family.
 */
export function LandingHero({ children }: { children: ReactNode }) {
  const { material, select, tensionRef, step, goTo, interact } = useLanding();
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
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
      const dir = dx > 0 ? -1 : 1;
      if (stepRef.current === 0) {
        select(materialRef.current + dir, dir, 0.3 + d.peak * 1.2);
        interact();
      } else {
        goTo(stepRef.current + dir);
      }
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

const CAPTIONS: Record<(typeof STEPS)[number]["id"], string> = {
  print:
    "Get prints delivered to your door, and pick from 60+ materials. Share your hardware projects and files.",
  share:
    "Publish your parts. Anyone can download them, or print them in a click.",
  build: "Host the whole build: every part, with its bill of materials.",
};

/**
 * The subheading follows the stepper. The first step's copy is what the
 * server renders, so crawlers read the product pitch.
 */
export function StepCaption() {
  const { step } = useLanding();
  const id = STEPS[step].id;
  return (
    <div className="grid max-w-lg">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={id}
          initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
          transition={{ duration: 0.28, ease: [0.22, 0.9, 0.28, 1] }}
          className="col-start-1 row-start-1 text-pretty text-base leading-relaxed text-foreground/90"
        >
          {CAPTIONS[id]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

const CONTROL =
  "glass-surface pointer-events-auto flex items-center justify-center rounded-full ring-1 ring-border/70 text-foreground/80 transition-[color,transform] duration-150 ease-spring hover:text-foreground active:scale-95";

/**
 * Apple-product-page stepper, centred at the bottom of the first screen:
 * chevrons either side of a dot pill whose active dot stretches into a
 * timer, plus play/pause. The fill's own `animationend` advances the
 * step, so the timer you see is the timer that fires. Any manipulation
 * pauses it; it picks back up after 10s untouched (landing-context).
 */
export function StepCarousel() {
  const { step, playing, goTo, advance, togglePlay } = useLanding();
  const reduced = useReducedMotion();
  const scrolledAway = useScrolledAway();
  const running = playing && !reduced && !scrolledAway;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center nav:bottom-8">
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Product tour"
      >
        <button
          type="button"
          aria-label="Previous"
          onClick={() => goTo(step - 1)}
          className={cn(CONTROL, "size-10")}
        >
          <ChevronLeft size={16} />
        </button>
        <div
          className={cn(
            CONTROL,
            "h-10 gap-2.5 px-4 hover:text-foreground/80 active:scale-100",
          )}
        >
          {STEPS.map((s, i) => {
            const active = i === step;
            return (
              <button
                key={s.id}
                type="button"
                aria-label={s.label}
                aria-current={active ? "step" : undefined}
                onClick={() => goTo(i)}
                className={cn(
                  "relative h-2 cursor-pointer overflow-hidden rounded-full transition-[width,background-color] duration-300 ease-spring",
                  active
                    ? "w-9 bg-foreground/20"
                    : "w-2 bg-foreground/30 hover:bg-foreground/50",
                )}
              >
                {active && (
                  <span
                    key={step}
                    onAnimationEnd={advance}
                    className="mz-step-fill absolute inset-0 origin-left rounded-full bg-foreground"
                    style={{
                      animationDuration: `${STEP_MS}ms`,
                      animationPlayState: running ? "running" : "paused",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Next"
          onClick={() => goTo(step + 1)}
          className={cn(CONTROL, "size-10")}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause tour" : "Play tour"}
          onClick={togglePlay}
          className={cn(CONTROL, "ml-1 size-10")}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>
    </div>
  );
}

/** Freeze the tour while the FAQ sheet is up — nobody is watching it. */
function useScrolledAway(): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const read = () => setAway(window.scrollY > window.innerHeight * 0.3);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return away;
}
