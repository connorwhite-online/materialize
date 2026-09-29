"use client";

import { Suspense, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { Environment, Lightformer } from "@react-three/drei";
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
 * Render resolution: the screen's own density, up to 2× (past that an
 * iPhone's 3× is ~2.25× the pixels for detail nobody sees at arm's
 * length). A flat 1.25× on phones was what made the scene look soft.
 *
 * DprGovernor steps it down — only down, in 0.25 notches, never below
 * DPR_FLOOR — if the frame rate really can't hold. It replaced drei's
 * PerformanceMonitor, which made things worse, not better: it judged the
 * first seconds while models decode and shaders compile, bounced, and
 * after a few flips fell back to 1× for good. Measured: even an
 * unthrottled desktop GPU sat at 2× for ~11s, then 1× forever.
 */
const DPR_FLOOR = 1.5;
const DPR_STEP = 0.25;
/** Ignore the load: decode, shader compile, texture upload. */
const WARMUP_S = 4;
/** Judge over this long, and step down below this frame rate. */
const WINDOW_S = 2;
const MIN_FPS = 45;
function maxDpr(): number {
  if (typeof window === "undefined") return 1.5;
  return Math.min(window.devicePixelRatio || 1, 2);
}

function DprGovernor({ top }: { top: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ t: 0, frames: 0, windowT: 0, dpr: top });
  useFrame((_, delta) => {
    const g = st.current;
    // A backgrounded tab reports huge deltas; not the device's fault.
    if (delta > 0.25) return;
    g.t += delta;
    if (g.t < WARMUP_S) return;
    g.frames += 1;
    g.windowT += delta;
    if (g.windowT < WINDOW_S) return;
    const fps = g.frames / g.windowT;
    g.frames = 0;
    g.windowT = 0;
    const floor = Math.min(DPR_FLOOR, top);
    if (fps < MIN_FPS && g.dpr > floor) {
      g.dpr = Math.max(floor, g.dpr - DPR_STEP);
      setDpr(g.dpr);
    }
  });
  return null;
}

const EDGE_FADE = {
  maskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
} as const;

export function EnclosureStage() {
  const [top] = useState(maxDpr);
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
          dpr={top}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            // A touch under 1: ACES rolls the highlights off like film.
            toneMappingExposure: 0.92,
          }}
        >
          <DprGovernor top={top} />
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
