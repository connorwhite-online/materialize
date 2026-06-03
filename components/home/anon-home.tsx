"use client";

import { useEffect, useRef, useState } from "react";
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

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

          {/* Material carousel drives the lone device's material. Pinned
              to the bottom; firing the spray on each change. */}
          <div className="mt-auto w-full pointer-events-auto">
            <MaterialCarousel
              materials={HERO_MATERIALS}
              selectedIndex={selectedIndex}
              onSelect={(i) => {
                setSelectedIndex(i);
                setBurstKey((k) => k + 1);
              }}
            />
            <p className="mt-4 text-center text-xs uppercase tracking-widest text-muted-foreground/70">
              Scroll to explore
            </p>
          </div>
        </section>

        {/* --- Stage 1 · Materials --- */}
        <SectionCopy
          kicker="A multitude of materials"
          title="One model, every material"
          body="Plastics, polished alloys, translucent resins and more — preview your part in each finish, with live vendor pricing before you commit."
        />

        {/* --- Stage 2 · Buy & sell --- */}
        <SectionCopy
          kicker="Buy & sell"
          title="A marketplace for makers"
          body="Sell your designs as collectible, ready-to-print files — or buy someone else's. Set a price or share for free; we only take a flat 3% service fee."
        />

        {/* --- Stage 3 · Teardown / firmware --- */}
        <SectionCopy
          kicker="Open hardware"
          title="Every file, down to the firmware"
          body="List the whole build — STLs, wiring diagrams, the bill of materials, and a link to the firmware repo. Everything someone needs to make it real."
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
    <section className="flex h-svh snap-start flex-col justify-start px-4 pt-20">
      {/* Copy sits at the top of every section, clear of the centered
          model below it, with a soft scrim so it stays legible over the
          scene. */}
      <div className="mx-auto max-w-lg rounded-2xl bg-background/60 px-4 py-3 text-center backdrop-blur-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-primary/80">
          {kicker}
        </p>
        <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-pretty text-base leading-relaxed text-muted-foreground">
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
