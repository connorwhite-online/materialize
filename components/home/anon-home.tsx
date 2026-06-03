"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthNav } from "@/components/auth/auth-nav";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { MaterialCarousel } from "@/components/home/material-carousel";
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

  // Live drag tension (-1..1), read by the device in the canvas to sway
  // with the swipe — written here, never triggers a re-render.
  const dragVelocityRef = useRef(0);

  const selectedIndexRef = useRef(1);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

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
          className="flex h-svh snap-start flex-col items-center px-4 pt-20 pb-40"
        >
          {/* Copy anchored to the top; the centered model lives below it. */}
          <div className="flex flex-col items-center text-center">
            <h1 className="flex flex-col items-center justify-center gap-0 leading-[0.95] sm:flex-row sm:items-baseline sm:gap-3">
              <span
                className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-6xl tracking-tight text-transparent sm:text-7xl lg:text-8xl"
                style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
              >
                Materialize
              </span>
              <span
                className="bg-gradient-to-b from-primary to-muted-foreground bg-clip-text text-6xl font-light text-transparent sm:text-7xl lg:text-8xl"
                style={{ fontFamily: "var(--font-script), cursive" }}
              >
                Anything
              </span>
            </h1>
            <p className="mt-3 max-w-md text-balance text-base leading-relaxed text-muted-foreground">
              The marketplace for 3D-print files — browse and buy designs, or get
              any model printed on demand and shipped to your door.
            </p>
          </div>

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
              to the bottom; firing the spray on each change. */}
          <div className="w-full pointer-events-auto">
            <MaterialCarousel
              materials={HERO_MATERIALS}
              selectedIndex={selectedIndex}
              onSelect={(i, direction) => handleSelect(i, direction, 1)}
            />
            <p className="mt-4 text-center text-xs uppercase tracking-widest text-muted-foreground/70">
              Scroll to explore
            </p>
          </div>
        </section>

        {/* --- Stage 1 · Materials --- */}
        <SectionCopy
          kicker="Materials"
          title="See every finish"
          body="Plastics, alloys, resins — your model priced live by real vendors."
        />

        {/* --- Stage 2 · Buy & sell --- */}
        <SectionCopy
          kicker="Marketplace"
          title="Buy & sell files"
          body="List a print-ready design or buy one. Flat 3% fee, nothing else."
        />

        {/* --- Stage 3 · Teardown / firmware --- */}
        <SectionCopy
          kicker="Open hardware"
          title="Down to the firmware"
          body="STLs, wiring, the BOM, and a link to the firmware repo."
        />

        {/* --- Stage 4 · Footer --- */}
        <HomeFooter />
      </div>

      <HomeBottomBar />
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
    <section className="flex h-svh snap-start flex-col justify-start px-4 pt-16">
      {/* Copy pinned to the very top, well clear of the centered model.
          No background container — a soft drop-shadow keeps it legible
          over the scene. */}
      <div className="mx-auto max-w-xs text-center [text-shadow:0_1px_12px_var(--background)] sm:max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/90">
          {kicker}
        </p>
        <h2 className="mt-1.5 text-2xl font-bold leading-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </section>
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
