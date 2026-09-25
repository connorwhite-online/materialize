"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useLanding } from "./landing-context";
import { EnclosureScene } from "./enclosure-scene";
import { MAX_PROGRESS } from "./choreography";

/**
 * Scroll progress in sections: 0 at the top, k when section k's top
 * reaches the top of the viewport, linear in between, clamped at the
 * last keyframe. Measured off `[data-landing-section]` so sections can
 * be any height (the FAQ runs taller than a screen).
 */
export function progressFor(scrollY: number, tops: number[]): number {
  if (tops.length < 2) return 0;
  for (let i = 0; i < tops.length - 1; i++) {
    if (scrollY < tops[i + 1]) {
      const span = tops[i + 1] - tops[i];
      return i + Math.max(0, (scrollY - tops[i]) / (span || 1));
    }
  }
  return tops.length - 1;
}

function useScrollProgress() {
  const { progressRef } = useLanding();
  useEffect(() => {
    let tops: number[] = [];
    const measure = () => {
      tops = [
        ...document.querySelectorAll<HTMLElement>("[data-landing-section]"),
      ]
        .map((el) => el.getBoundingClientRect().top + window.scrollY)
        .slice(0, MAX_PROGRESS + 1);
      update();
    };
    const update = () => {
      progressRef.current = Math.min(
        MAX_PROGRESS,
        progressFor(window.scrollY, tops),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [progressRef]);
}

/**
 * Fixed, full-viewport canvas behind every landing section. It never
 * takes pointer events itself — the hero section owns the swipe, and
 * the file-label download buttons opt back in on their own.
 */
export function EnclosureStage() {
  useScrollProgress();
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
