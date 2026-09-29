"use client";

import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import {
  Environment,
  Lightformer,
  PerformanceMonitor,
} from "@react-three/drei";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EnclosureScene } from "./enclosure-scene";

/**
 * Fixed, full-viewport canvas behind every landing section. It never
 * takes pointer events itself — the hero section owns the swipe, and
 * the file-label download buttons opt back in on their own.
 */
/**
 * The glow and vignette fade out over the top and bottom 10%, so the stage
 * meets the screen edges at exactly --background. In a Safari tab the
 * status-bar and toolbar bands are painted with <body>'s plain colour; a
 * stage that was brighter (bottom glow) or darker (vignette) there showed
 * as a hard line at both bands.
 */
/**
 * Render resolution adapts to the device instead of a fixed cap. It
 * starts at the screen's own density (up to 2×: past that an iPhone's 3×
 * is ~2.25× the pixels for detail nobody can see at arm's length) and
 * PerformanceMonitor steps it down in 0.25 notches only while the frame
 * rate can't hold, and back up when it recovers. A flat 1.25× on phones
 * was the real cause of the soft, low-res look: on a 3× screen every
 * edge and highlight was upscaled ~2.4×. (The meshes were not: a
 * normal-map bake from the full CAD came back essentially flat — the
 * shipped 25% shells already hold all the detail the source has.)
 */
const DPR_MIN = 1;
function maxDpr(): number {
  if (typeof window === "undefined") return 1.5;
  return Math.min(window.devicePixelRatio || 1, 2);
}

const EDGE_FADE = {
  maskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
} as const;

export function EnclosureStage() {
  const [top] = useState(maxDpr);
  const [dpr, setDpr] = useState(top);
  const reducedMotion = useReducedMotion() ?? false;
  return (
    // Opaque, flat --background base: it covers <body>'s fixed bottom-up
    // gradient on the landing. Safari fills the toolbar band with the
    // body's flat colour and ignores the gradient, so the gradient's
    // darker bottom met the band in a visible line.
    <div
      aria-hidden
      // top-0 + h-lvh, not inset-0: sized to the LARGE viewport, the canvas
      // never resizes as iOS Safari's toolbar collapses on scroll (it did,
      // and the whole scene re-laid out: a visible shift/scale).
      className="mz-landing-stage pointer-events-none fixed inset-x-0 top-0 z-0 h-lvh bg-background"
    >
      {/* A warm pool of light behind the device, like a floor spot on a
          set — the canvas is transparent over it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 62% 42%, rgba(255,236,214,0.07), transparent 70%), radial-gradient(120% 90% at 50% 110%, rgba(255,228,200,0.04), transparent 60%)",
          ...EDGE_FADE,
        }}
      />
      <ErrorBoundary fallback={null}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 35 }}
          // The burn sweep (burn-sweep.ts) clips each shell with planes;
          // three ignores material clipping planes unless this is on.
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
          }}
          dpr={dpr}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            // A touch under 1: ACES rolls the highlights off like film.
            toneMappingExposure: 0.92,
          }}
        >
          <PerformanceMonitor
            // Judged over ~1s windows; a couple of flips and it settles.
            flipflops={3}
            // Start at full quality (drei defaults to 0.5, which knocked
            // every device straight down to the middle).
            factor={1}
            onChange={({ factor }) => {
              const next =
                Math.round((DPR_MIN + (top - DPR_MIN) * factor) * 4) / 4;
              setDpr(next);
            }}
            onFallback={() => setDpr(DPR_MIN)}
          />
          <WarmStudio />
          <Suspense fallback={null}>
            <EnclosureScene reducedMotion={reducedMotion} />
          </Suspense>
        </Canvas>
      </ErrorBoundary>
      {/* Soft vignette over the stage only. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(8,7,6,0.55) 100%)",
          ...EDGE_FADE,
        }}
      />
    </div>
  );
}

/**
 * Studio light for the landing only (the product viewer keeps the
 * neutral StudioEnvironment): a soft warm-white key from the upper left,
 * a pale warm rim behind, and a faint cool fill so shadows keep depth.
 * Deliberately only a hint of warmth — full tungsten/amber, through ACES,
 * pushed the white shell pink/orange. Baked into an in-memory env map,
 * no HDR fetch.
 */
function WarmStudio() {
  return (
    <>
      <ambientLight intensity={0.18} color="#f4ede4" />
      <directionalLight position={[-4, 5, 5]} intensity={2.1} color="#fff0dc" />
      <directionalLight position={[3, 2, -6]} intensity={0.8} color="#ffd9b3" />
      <directionalLight
        position={[5, -2, 3]}
        intensity={0.35}
        color="#c4d3ff"
      />
      {/* Rendered once, at load: 512 costs nothing per frame and keeps
          reflections on the polished finishes crisp (256 smeared them). */}
      <Environment resolution={512}>
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#fff1de"
          position={[-2.5, 3, 4]}
          scale={[6, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#ffd6ad"
          position={[0, 1.5, -5]}
          scale={[8, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.35}
          color="#cfdbff"
          position={[5, 0, 1]}
          scale={[2, 6, 1]}
        />
        <Lightformer
          form="ring"
          intensity={0.4}
          color="#ffe2c6"
          position={[0, -4, 0]}
          scale={[10, 10, 1]}
        />
      </Environment>
    </>
  );
}
