"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AuthNav } from "@/components/auth/auth-nav";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { MaterialCarousel } from "@/components/home/material-carousel";
import { ScrollIndicator } from "@/components/home/scroll-indicator";
import { ScrollReveal } from "@/components/home/scroll-reveal";
import { HomeScene } from "@/components/home/scene/home-scene-lazy";
import { HERO_MATERIALS } from "@/lib/materials";
import { ChevronRight } from "@/components/icons/chevron-right";

/**
 * Anon home as a scroll-driven cinematic: a single persistent 3D scene
 * stays pinned full-viewport while the reader scrolls through five
 * snapped sections. The eased scroll position morphs the device — one
 * object that multiplies into material swatches, seals into a sale box,
 * and explodes into a labelled teardown.
 *
 * This component is client-side but still server-rendered (only the
 * <HomeScene> canvas is ssr:false), so all the section copy below ships
 * as real, crawlable HTML.
 */
export function AnonHome() {
  const progressRef = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  // Start on a metal (Steel) rather than the cream "Plastics" so the
  // device has contrast against the light-mode cream background on first
  // paint — cream-on-cream renders effectively invisible.
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [burstKey, setBurstKey] = useState(0);
  const [burstDirection, setBurstDirection] = useState(0);
  const [burstIntensity, setBurstIntensity] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);

  // First-visit hero intro: the "Anything" slot cycles through the
  // material names (with the device material changing in step), then the
  // header slides from centre to top-left and the carousel + subheading
  // fade in. Plays once per browser; repeat visits (and reduced-motion)
  // render the settled layout immediately — which is also the SSR state,
  // so the crawlable <h1> ("Materialize Anything") is unaffected.
  const [introPlaying, setIntroPlaying] = useState(false);
  const [wordSettled, setWordSettled] = useState(false);
  const [heroExtras, setHeroExtras] = useState(true);
  const heroWord =
    introPlaying && !wordSettled ? HERO_MATERIALS[selectedIndex].name : "Anything";

  // Live drag tension (-1..1), read by the device in the canvas to sway
  // with the swipe — written here, never triggers a re-render.
  const dragVelocityRef = useRef(0);

  const selectedIndexRef = useRef(1);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Kick off the intro on first visit only (before paint, so there's no
  // flash of the settled layout). matchMedia is checked directly since
  // the reducedMotion state lands a tick later.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem("mz_hero_intro_v1");
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || prefersReduced) return;
    setIntroPlaying(true);
    setWordSettled(false);
    setHeroExtras(false);
  }, []);

  // Run the cycle, then settle: land on "Anything", slide the header to
  // top-left, and fade in the carousel + subheading.
  useEffect(() => {
    if (!introPlaying) return;
    const n = HERO_MATERIALS.length;
    const order: number[] = [];
    for (let s = 0; s < n + 1; s++) order.push(s % n);
    if (order[order.length - 1] !== 1) order.push(1);

    const timers: number[] = [];
    let i = 0;
    setSelectedIndex(order[0]);
    const tick = window.setInterval(() => {
      i += 1;
      if (i < order.length) {
        setSelectedIndex(order[i]);
        return;
      }
      window.clearInterval(tick);
      window.localStorage.setItem("mz_hero_intro_v1", "1");
      // Land the word, then slide the header, then reveal the extras.
      setWordSettled(true);
      timers.push(window.setTimeout(() => setIntroPlaying(false), 420));
      timers.push(window.setTimeout(() => setHeroExtras(true), 420 + 720));
    }, 300);

    return () => {
      window.clearInterval(tick);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [introPlaying]);

  // Select + fire the directional spray. Shared by taps and swipes.
  // burstDirection is negated so the spray flies WITH the finger (the
  // carousel step is opposite the drag), matching production.
  const handleSelect = useCallback(
    (index: number, direction: number, intensity = 1) => {
      setSelectedIndex(index);
      setBurstDirection(-direction);
      setBurstIntensity(intensity);
      setBurstKey((k) => k + 1);
    },
    []
  );

  // Full production swipe gesture: tanh position-tension drives the live
  // device sway during the drag; on release a past-threshold horizontal
  // swipe steps ±1 with a velocity-scaled spray. touchAction: pan-y lets
  // vertical scroll/snap through while we own horizontal moves.
  const SWIPE_THRESHOLD = 30;
  const VERTICAL_CANCEL = 40;
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    peakVelocity: 0,
    cancelled: false,
  });

  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastTime: performance.now(),
      peakVelocity: 0,
      cancelled: false,
    };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s.active || s.cancelled) return;
    const totalDx = e.clientX - s.startX;
    const totalDy = e.clientY - s.startY;
    if (Math.abs(totalDy) > VERTICAL_CANCEL && Math.abs(totalDy) > Math.abs(totalDx)) {
      s.cancelled = true;
      dragVelocityRef.current = 0;
      return;
    }
    const dx = e.clientX - s.lastX;
    const now = performance.now();
    const dt = Math.max(1, now - s.lastTime);
    s.lastX = e.clientX;
    s.lastTime = now;
    // Position-based spring tension; tanh asymptotes so resistance grows.
    dragVelocityRef.current = Math.tanh(totalDx / 220);
    const instVel = Math.min(1, Math.abs((dx / dt) * 20));
    if (instVel > s.peakVelocity) s.peakVelocity = instVel;
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s.active) return;
    s.active = false;
    dragVelocityRef.current = 0;
    if (s.cancelled) return;
    const totalDx = e.clientX - s.startX;
    if (Math.abs(totalDx) > SWIPE_THRESHOLD) {
      const direction = totalDx > 0 ? -1 : 1;
      const current = selectedIndexRef.current;
      const next = Math.max(0, Math.min(HERO_MATERIALS.length - 1, current + direction));
      if (next !== current) {
        handleSelect(next, direction, 0.3 + s.peakVelocity * 1.2);
      }
    }
  };

  // prefers-reduced-motion → freeze idle motion and snap transitions.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Document-scroll → stage progress. Measured against a real section's
  // height (not innerHeight) so the mapping is stable as the mobile URL
  // bar shows/hides.
  useEffect(() => {
    document.documentElement.classList.add("snap-home");
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const unit = sectionRef.current?.offsetHeight || window.innerHeight;
        progressRef.current = window.scrollY / unit;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.documentElement.classList.remove("snap-home");
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="relative">
      {/* Persistent scene, pinned behind every section. */}
      <div className="fixed inset-0 z-0">
        <HomeScene
          progressRef={progressRef}
          material={HERO_MATERIALS[selectedIndex]}
          burstKey={burstKey}
          burstDirection={burstDirection}
          burstIntensity={burstIntensity}
          dragVelocityRef={dragVelocityRef}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* Minimal header — auth nav only; the hero wordmark is the brand. */}
      <header className="fixed inset-x-0 top-0 z-30">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-end px-4">
          <AuthNav />
        </div>
      </header>

      {/* Scrolling content. pointer-events-none lets drags over the
          scene scroll the page; interactive bits opt back in. */}
      <div className="relative z-10 pointer-events-none">
        {/* --- Stage 0 · Hero --- */}
        <section
          ref={sectionRef}
          data-home-section
          className="flex h-svh snap-start flex-col items-start px-4 pt-20 pb-40"
        >
          {/* Settled copy — top-left, left-aligned (also the SSR /
              repeat-visit state, so the crawlable <h1> ships here). */}
          {!introPlaying && (
            <ScrollReveal className="w-full max-w-md text-left">
              <motion.h1
                layoutId="hero-heading"
                transition={{ duration: 0.7, ease: "linear" }}
                className="flex flex-col items-start leading-[0.95]"
              >
                <span
                  className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-5xl tracking-tight text-transparent sm:text-6xl"
                  style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
                >
                  Materialize
                </span>
                <span
                  className="bg-gradient-to-b from-primary to-muted-foreground bg-clip-text text-5xl font-light text-transparent sm:text-6xl"
                  style={{ fontFamily: "var(--font-script), cursive" }}
                >
                  Anything
                </span>
              </motion.h1>
              <motion.p
                initial={false}
                animate={{ opacity: heroExtras ? 1 : 0, y: heroExtras ? 0 : 8 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="mt-3 max-w-md text-left text-base leading-relaxed text-muted-foreground"
              >
                The marketplace for 3D-print files — browse and buy designs, or get
                any model printed on demand and shipped to your door.
              </motion.p>
            </ScrollReveal>
          )}

          {/* Intro overlay — centred, large; the "Anything" slot cycles
              through the material names before the header settles. */}
          {introPlaying && (
            <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-6">
              <motion.h1
                layoutId="hero-heading"
                transition={{ duration: 0.7, ease: "linear" }}
                className="flex flex-col items-center text-center leading-[0.95]"
              >
                <span
                  className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-7xl tracking-tight text-transparent sm:text-8xl"
                  style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
                >
                  Materialize
                </span>
                <CyclingWord text={heroWord} />
              </motion.h1>
            </div>
          )}

          {/* Drag-to-scrub zone over the centered model — restores the
              original horizontal swipe gesture for changing materials. */}
          <div
            className="w-full flex-1 pointer-events-auto cursor-grab active:cursor-grabbing"
            style={{ touchAction: "pan-y" }}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            aria-hidden
          />

          {/* Material carousel drives the lone device's material. Pinned
              to the bottom; fades in after the intro settles. */}
          <motion.div
            initial={false}
            animate={{ opacity: heroExtras ? 1 : 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full"
            style={{ pointerEvents: heroExtras ? "auto" : "none" }}
          >
            <MaterialCarousel
              materials={HERO_MATERIALS}
              selectedIndex={selectedIndex}
              onSelect={(i, direction) => handleSelect(i, direction, 1)}
            />
          </motion.div>
        </section>

        {/* --- Stage 1 · Manufacturing --- */}
        <SectionCopy
          kicker="Global supply chain"
          title="Printed to order, worldwide"
          body="A vetted network of manufacturers builds your part on demand — in your material, wherever you are."
        />

        {/* --- Stage 2 · Assembly / teardown --- */}
        <SectionCopy
          kicker="Open hardware"
          title="Down to the firmware"
          body="STLs, wiring, the BOM, and a link to the firmware repo."
        />

        {/* --- Stage 3 · Packaging / buy & sell --- */}
        <SectionCopy
          kicker="Marketplace"
          title="Buy & sell files"
          body="List a print-ready design or buy one. Flat 3% fee, nothing else."
        />

        {/* --- Stage 4 · Footer --- */}
        <HomeFooter />
      </div>

      <HomeBottomBar />

      {/* Section pager — fixed to the right edge, vertically centered. */}
      <div className="fixed right-3 top-1/2 z-30 -translate-y-1/2">
        <ScrollIndicator />
      </div>
    </div>
  );
}

function SectionCopy({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <section data-home-section className="flex h-svh snap-start flex-col items-start justify-start px-4 pt-20">
      {/* Copy pinned top-left (matching the settled hero), well clear of
          the centered model. No background container — a soft drop-shadow
          keeps it legible over the scene. */}
      <ScrollReveal className="w-full max-w-md text-left [text-shadow:0_1px_12px_var(--background)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/90">
          {kicker}
        </p>
        <h2 className="mt-1.5 text-2xl font-bold leading-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </ScrollReveal>
    </section>
  );
}

/**
 * The hero's cycling word slot. An invisible spacer sizes the slot to the
 * current word; the visible word is absolutely overlaid so each swap
 * cross-fades with an x / blur / opacity / scale transition (no layout
 * jump) — a slot-reel through the material names that lands on "Anything".
 */
function CyclingWord({ text }: { text: string }) {
  const wordClass =
    "bg-gradient-to-b from-primary to-muted-foreground bg-clip-text text-7xl font-light text-transparent sm:text-8xl";
  const wordStyle = { fontFamily: "var(--font-script), cursive" } as const;
  return (
    <span className="relative inline-flex justify-center">
      <span className={`${wordClass} invisible whitespace-nowrap`} style={wordStyle} aria-hidden>
        {text}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, filter: "blur(10px)", x: 26, scale: 0.82 }}
          animate={{ opacity: 1, filter: "blur(0px)", x: 0, scale: 1 }}
          exit={{ opacity: 0, filter: "blur(10px)", x: -26, scale: 0.82 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className={`${wordClass} absolute inset-0 flex justify-center whitespace-nowrap`}
          style={wordStyle}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function HomeFooter() {
  return (
    <footer className="pointer-events-auto flex min-h-[60svh] snap-start flex-col justify-end">
      <div className="border-t border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-14 pb-44">
          <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm space-y-2">
              <p
                className="text-2xl tracking-tight"
                style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
              >
                Materialize
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                A marketplace for 3D-print files with on-demand printing built
                in. Find a design, choose a material, and have it manufactured
                and shipped — or upload your own models and sell them.
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              <FooterLink href="/files">Browse files</FooterLink>
              <FooterLink href="/materials">Materials</FooterLink>
              <FooterLink href="/sign-up">Start selling</FooterLink>
              <FooterLink href="/sign-in">Sign in</FooterLink>
            </nav>
          </div>
          <p className="mt-12 text-xs text-muted-foreground/70">
            © {new Date().getFullYear()} Materialize · Print anything.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <ChevronRight size={13} />
    </Link>
  );
}
