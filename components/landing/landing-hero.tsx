"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { cn } from "@/lib/utils";
import { STEPS, STEP_MS, useLanding } from "./landing-context";

const VERTICAL_CANCEL = 40;

/**
 * First screen of the anon landing — the whole story lives here, driven
 * by the stepper rather than by scrolling. Owns the horizontal swipe (the
 * canvas behind is pointer-events: none): on every step a drag tugs the
 * scene round with some tension and springs back (drag-orbit). Materials
 * change on their own via the burn sweep (burn-sweep.ts).
 */
export function LandingHero({ children }: { children: ReactNode }) {
  const { orbitRef, interact } = useLanding();
  const ref = useRef<HTMLElement>(null);
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
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
      orbitRef.current = 0;
      return;
    }
    // Every movement restarts the idle countdown (interact is cheap and
    // idempotent), so a long drag never times out mid-gesture.
    interact();
    // tanh asymptote = resistance that grows as the finger pulls further;
    // the scene springs back on release.
    orbitRef.current = Math.tanh(dx / 260);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    orbitRef.current = 0;
    // The 10s idle clock starts from letting go.
    interact();
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

const COPY: Record<
  (typeof STEPS)[number]["id"],
  { title: ReactNode; body: string }
> = {
  print: {
    title: (
      <>
        Print anything,
        <br />
        share your ideas
      </>
    ),
    body: "Get prints delivered to your door, and pick from 60+ materials. Share your hardware projects and files.",
  },
  build: {
    title: "Host the whole build",
    body: "Parts, bill of materials, and wiring diagrams.",
  },
  agents: {
    title: "Built with agents",
    body: "Your agent can host the project, quote it and order the print.",
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
  const prev = usePreviousStep(step);

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
                  // Ease-out, no spring: the spring overshot (36→36.2px, 8→7.8px)
                  // and read as a wobble on every step change.
                  "relative h-2 cursor-pointer overflow-hidden rounded-full transition-[width,background-color] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                  active && running
                    ? "w-9 bg-foreground/20"
                    : active
                      ? "w-2 bg-foreground"
                      : "w-2 bg-foreground/30 hover:bg-foreground/50",
                )}
              >
                {active && running && (
                  // Keyed on the run too: resuming restarts the timer. It
                  // waits out the dot's own 450ms stretch before filling,
                  // so the bar never lurches with a width still changing.
                  <span
                    key={`${step}-${run}`}
                    onAnimationEnd={advance}
                    className="mz-step-fill absolute inset-0 rounded-full bg-foreground"
                    style={{
                      animationDuration: `${STEP_MS}ms`,
                      animationDelay: "450ms",
                    }}
                  />
                )}
                {!active && i === prev && (
                  // The step just finished: its full bar fades out while
                  // the dot shrinks, instead of blinking white → grey.
                  <span
                    key={`done-${step}`}
                    className="mz-step-done absolute inset-0 rounded-full bg-foreground"
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

/** The step shown before the current one (derived state, no effect). */
function usePreviousStep(step: number): number | null {
  const [cur, setCur] = useState(step);
  const [prev, setPrev] = useState<number | null>(null);
  if (step !== cur) {
    setPrev(cur);
    setCur(step);
  }
  return prev;
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

/**
 * What the agent is doing, as a live call log beside the spark: the real
 * MCP tool names (app/api/[transport]/route.ts), in the order an agent
 * would ship a build. Deliberately no prices: they'd be invented.
 */
const AGENT_CALLS = [
  { tool: "materialize_create_project", result: "Pneuma S · 9 parts" },
  { tool: "materialize_set_project_bom", result: "14 line items" },
  { tool: "materialize_get_quote", result: "Hard TPU · 2 parts" },
  { tool: "materialize_create_order", result: "Order placed" },
] as const;
/** First line lands once the cable's first pulse reaches the port. */
const LOG_START_MS = 1500;
const LOG_EVERY_MS = 650;

/**
 * Shown only on the agents step, and re-keyed per visit so each arrival
 * replays the calls from the top.
 */
export function AgentLog() {
  const { step } = useLanding();
  const [visit, setVisit] = useState(0);
  const [wasAgents, setWasAgents] = useState(false);
  const onAgents = STEPS[step].id === "agents";
  if (onAgents !== wasAgents) {
    setWasAgents(onAgents);
    if (onAgents) setVisit((v) => v + 1);
  }
  return (
    <AnimatePresence>
      {onAgents && <AgentLogLines key={visit} />}
    </AnimatePresence>
  );
}

function AgentLogLines() {
  const [shown, setShown] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const timers = AGENT_CALLS.map((_, i) =>
      window.setTimeout(
        () => setShown(i + 1),
        reduced ? 0 : LOG_START_MS + i * LOG_EVERY_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [reduced]);
  return (
    <motion.ol
      aria-label="Agent activity"
      exit={{ opacity: 0, filter: "blur(6px)" }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none absolute right-3 top-[29%] z-10 flex w-[56vw] flex-col gap-1.5 nav:left-[64%] nav:right-auto nav:top-[24%] nav:w-[min(380px,30vw)] nav:gap-2"
    >
      {AGENT_CALLS.slice(0, shown).map((c, i) => (
        <motion.li
          key={c.tool}
          initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.32, ease: [0.22, 0.9, 0.28, 1] }}
          className="glass-surface flex items-center gap-2 rounded-xl px-2.5 py-1.5 font-mono text-[10px] ring-1 ring-border/70 nav:px-3 nav:py-2 nav:text-xs"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              i === shown - 1 && shown < AGENT_CALLS.length
                ? "animate-pulse bg-sky-400"
                : "bg-sky-400/70",
            )}
          />
          <span className="min-w-0 truncate text-foreground/90">
            {/* The namespace eats a phone's width; the verb is the point. */}
            <span className="hidden nav:inline">materialize_</span>
            {c.tool.replace(/^materialize_/, "")}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {c.result}
          </span>
        </motion.li>
      ))}
    </motion.ol>
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
