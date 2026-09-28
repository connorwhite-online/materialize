"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
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
const EDGE_FADE = {
  maskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
} as const;

export function EnclosureStage() {
  const reducedMotion = useReducedMotion() ?? false;
  return (
    // Opaque, flat --background base: it covers <body>'s fixed bottom-up
    // gradient on the landing. Safari fills the toolbar band with the
    // body's flat colour and ignores the gradient, so the gradient's
    // darker bottom met the band in a visible line.
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 bg-background"
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
          // 1.5, not 2: this is a background. At 2 a retina laptop renders
          // ~3M pixels per frame for it; 1.5 is ~44% fewer and reads the same.
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            // A touch under 1: ACES rolls the highlights off like film.
            toneMappingExposure: 0.92,
          }}
        >
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
      <Environment resolution={256}>
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
