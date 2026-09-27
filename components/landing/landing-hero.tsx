"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { cn } from "@/lib/utils";
import { STEPS, STEP_MS, useLanding } from "./landing-context";
import { INTRO_SEQUENCE, INTRO_STEP_MS } from "./landing-materials";

const SWIPE_THRESHOLD = 30;
const VERTICAL_CANCEL = 40;

/**
 * First screen of the anon landing — the whole story lives here, driven
 * by the stepper rather than by scrolling. Owns the horizontal swipe (the
 * canvas behind is pointer-events: none): on the first step it changes
 * the material; on the others it tugs the scene round (drag-orbit). Also runs the
 * load-time intro that whooshes through every material family.
 */
export function LandingHero({ children }: { children: ReactNode }) {
  const { material, select, tensionRef, orbitRef, step, interact } =
    useLanding();
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
    // Touching the stage stops the tour at once — not just on a finished
    // swipe — so it can't advance out from under a drag.
    interact();
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
      orbitRef.current = 0;
      return;
    }
    // Every movement restarts the idle countdown (interact is cheap and
    // idempotent), so a long drag never times out mid-gesture.
    interact();
    const now = performance.now();
    const v = Math.min(
      1,
      Math.abs(((e.clientX - d.lastX) / Math.max(1, now - d.lastT)) * 20),
    );
    d.peak = Math.max(d.peak, v);
    d.lastX = e.clientX;
    d.lastT = now;
    // tanh asymptote = resistance that grows as the finger pulls further.
    // First step: stretch the shell toward a material swap. Share/BOM:
    // tug the scene round — it springs back on release.
    if (stepRef.current === 0) tensionRef.current = Math.tanh(dx / 220);
    else orbitRef.current = Math.tanh(dx / 260);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    tensionRef.current = 0;
    orbitRef.current = 0;
    // The 10s idle clock starts from letting go.
    interact();
    if (d.cancelled) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) <= SWIPE_THRESHOLD) return;
    if (stepRef.current === 0) {
      const dir = dx > 0 ? -1 : 1;
      select(materialRef.current + dir, dir, 0.3 + d.peak * 1.2);
    }
  };

  // Non-passive touchmove so a horizontal drag doesn't trigger iOS
  // edge-swipe-back; vertical scrolling is left alone (touch-action).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    // Never on controls: cancelling touchmove on a slightly wobbly tap
    // swallows the click, which is how chevrons "sometimes didn't work".
    let onControl = false;
    const start = (e: TouchEvent) => {
      onControl = !!(e.target as Element | null)?.closest("a,button");
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (onControl) return;
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

const COPY: Record<
  (typeof STEPS)[number]["id"],
  { title: ReactNode; body: string }
> = {
  print: {
    title: (
      <>
        Print <HeroWord />,
        <br />
        share your ideas
      </>
    ),
    body: "Get prints delivered to your door, and pick from 60+ materials. Share your hardware projects and files.",
  },
  share: {
    title: "Share your files",
    body: "Publish the parts. Anyone can download or print them.",
  },
  build: {
    title: "Host the whole build",
    body: "Every part, with its bill of materials.",
  },
};

const FADE = {
  initial: { opacity: 0, filter: "blur(8px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: { opacity: 0, filter: "blur(8px)" },
  transition: { duration: 0.32, ease: [0.22, 0.9, 0.28, 1] as const },
};

/**
 * Headline + subtext for the current step, each swapping with an
 * opacity/blur fade. One real <h1> whose contents change; the server
 * renders the first step, so crawlers read the product pitch. Old and
 * new copy share a grid cell while they cross, so nothing jumps.
 */
export function StepCopy() {
  const { step } = useLanding();
  const id = STEPS[step].id;
  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-4 text-left">
      <h1 className="grid text-2xl leading-[1.1] tracking-tight sm:text-4xl">
        <AnimatePresence initial={false}>
          <motion.span
            key={id}
            {...FADE}
            className="col-start-1 row-start-1 self-end"
          >
            {COPY[id].title}
          </motion.span>
        </AnimatePresence>
      </h1>
      <div className="grid max-w-lg">
        <AnimatePresence initial={false}>
          <motion.p
            key={id}
            {...FADE}
            className="col-start-1 row-start-1 text-pretty text-base leading-relaxed text-foreground/90"
          >
            {COPY[id].body}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

const CONTROL =
  "glass-surface pointer-events-auto flex cursor-pointer items-center justify-center rounded-full ring-1 ring-border/70 text-foreground/80 transition-[color,transform] duration-150 ease-spring hover:text-foreground active:scale-95";

/**
 * Apple-product-page stepper, centred at the bottom of the first screen:
 * chevrons either side of a dot pill whose active dot stretches into a
 * timer while the tour runs. The fill's own `animationend` advances the
 * step, so the timer you see is the timer that fires. Any manipulation
 * stops it and collapses the dot; after 10s untouched the dot stretches
 * back out and the timer restarts (landing-context). No pause button:
 * interacting is the pause.
 */
export function StepCarousel() {
  const { step, playing, goTo, advance } = useLanding();
  const reduced = useReducedMotion();
  const scrolledAway = useScrolledAway();
  const running = playing && !reduced && !scrolledAway;
  const run = useRunCount(running);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center nav:bottom-8">
      <div
        className="flex items-center gap-1.5"
        role="group"
        aria-label="Product tour"
      >
        <button
          type="button"
          aria-label="Previous"
          onClick={() => goTo(step - 1)}
          className={cn(CONTROL, "size-9")}
        >
          <ChevronLeft size={20} />
        </button>
        <div
          className={cn(
            CONTROL,
            "h-9 gap-2 px-3 hover:text-foreground/80 active:scale-100",
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
                // Only a running timer earns the stretched pill. The moment
                // someone interacts it collapses to a plain dot (solid =
                // you are here); it stretches back out only when the idle
                // window ends and the timer starts again, from zero.
                className={cn(
                  "relative h-2 cursor-pointer overflow-hidden rounded-full transition-[width,background-color] duration-300 ease-spring",
                  active && running
                    ? "w-9 bg-foreground/20"
                    : active
                      ? "w-2 bg-foreground"
                      : "w-2 bg-foreground/30 hover:bg-foreground/50",
                )}
              >
                {active && running && (
                  // Keyed on the run too: resuming restarts the timer.
                  <span
                    key={`${step}-${run}`}
                    onAnimationEnd={advance}
                    className="mz-step-fill absolute inset-0 rounded-full bg-foreground"
                    style={{ animationDuration: `${STEP_MS}ms` }}
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
          className={cn(CONTROL, "size-9")}
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}

/** Counts transitions into running, to re-key (restart) the timer. */
function useRunCount(running: boolean): number {
  const [count, setCount] = useState(0);
  const [was, setWas] = useState(running);
  if (running !== was) {
    setWas(running);
    if (running) setCount((c) => c + 1);
  }
  return count;
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
