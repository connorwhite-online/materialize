"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useLanding } from "./landing-context";
import { EnclosureScene } from "./enclosure-scene";

/**
 * How far the FAQ sheet has been pulled up over the stage: 0 at the top,
 * 1 once the page has scrolled most of a screen. The first screen tells
 * the story through the stepper; scrolling only brings the sheet in.
 */
export function zoomFor(scrollY: number, viewportH: number): number {
  return Math.min(1, Math.max(0, scrollY / (viewportH * 0.8 || 1)));
}

function useScrollZoom() {
  const { zoomRef } = useLanding();
  useEffect(() => {
    const update = () => {
      zoomRef.current = zoomFor(window.scrollY, window.innerHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [zoomRef]);
}

/**
 * Fixed, full-viewport canvas behind every landing section. It never
 * takes pointer events itself — the hero section owns the swipe, and
 * the file-label download buttons opt back in on their own.
 */
export function EnclosureStage() {
  useScrollZoom();
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      {/* A warm pool of light behind the device, like a floor spot on a
          set — the canvas is transparent over it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 62% 42%, rgba(255,196,140,0.10), transparent 70%), radial-gradient(120% 90% at 50% 110%, rgba(255,170,110,0.06), transparent 60%)",
        }}
      />
      <ErrorBoundary fallback={null}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 35 }}
          dpr={[1, 2]}
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
      {/* Film finish: soft vignette + fine grain over the stage only. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(10,6,3,0.55) 100%)",
        }}
      />
      <div className="mz-film-grain absolute inset-0" />
    </div>
  );
}

/**
 * Warm, vintage-studio light for the landing only (the product viewer
 * keeps the neutral StudioEnvironment): a tungsten key softbox from the
 * upper left, an amber rim behind, and a faint cool fill so shadows keep
 * some depth instead of going muddy. Everything is baked into an
 * in-memory env map — no HDR fetch.
 */
function WarmStudio() {
  return (
    <>
      <ambientLight intensity={0.18} color="#ffd9b0" />
      <directionalLight position={[-4, 5, 5]} intensity={2.1} color="#ffcf98" />
      <directionalLight position={[3, 2, -6]} intensity={1.1} color="#ffab5e" />
      <directionalLight
        position={[5, -2, 3]}
        intensity={0.22}
        color="#a9c2ff"
      />
      <Environment resolution={256}>
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ffd2a1"
          position={[-2.5, 3, 4]}
          scale={[6, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#ffae63"
          position={[0, 1.5, -5]}
          scale={[8, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.35}
          color="#b8c9ff"
          position={[5, 0, 1]}
          scale={[2, 6, 1]}
        />
        <Lightformer
          form="ring"
          intensity={0.4}
          color="#ffb77a"
          position={[0, -4, 0]}
          scale={[10, 10, 1]}
        />
      </Environment>
    </>
  );
}
