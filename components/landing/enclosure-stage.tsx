"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
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
      <ErrorBoundary fallback={null}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 35 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <directionalLight position={[-5, -3, -5]} intensity={0.5} />
          <StudioEnvironment />
          <Suspense fallback={null}>
            <EnclosureScene reducedMotion={reducedMotion} />
          </Suspense>
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
