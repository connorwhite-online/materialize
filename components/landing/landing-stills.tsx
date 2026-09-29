"use client";

import { STEPS, useLanding } from "./landing-context";

/**
 * EXPERIMENT (`/?look=stills`): the three steps as Blender renders
 * instead of the live WebGL stage, while the two directions are being
 * weighed. Same stepper, copy and timing; each still crossfades with its
 * step. Renders are full screen height — the desktop 16:10 frame or the
 * phone's own portrait frame, picked by orientation — and sit over the
 * same flat backdrop as the 3D stage.
 *
 * Source: Desktop/Materialize Landing Renders (Blender Cycles, see its
 * Source/scene.py); web copies in public/home/stills.
 */
export function LandingStills() {
  const { step } = useLanding();
  return (
    <div
      aria-hidden
      className="mz-landing-stage pointer-events-none fixed inset-x-0 top-0 z-0 h-lvh bg-background"
    >
      {STEPS.map((s, i) => (
        <picture
          key={s.id}
          className="absolute inset-0 transition-opacity duration-700 ease-out"
          style={{ opacity: i === step ? 1 : 0 }}
        >
          <source
            media="(orientation: portrait)"
            srcSet={`/home/stills/step-${i + 1}-mobile.webp`}
          />
          <img
            src={`/home/stills/step-${i + 1}-desktop.webp`}
            alt=""
            // Desktop: nudged right of the bottom-left copy block.
            className="h-full w-full object-cover nav:translate-x-[8%] nav:-translate-y-[4%] nav:scale-[0.86]"
            fetchPriority={i === 0 ? "high" : "low"}
            decoding="async"
          />
        </picture>
      ))}
    </div>
  );
}
