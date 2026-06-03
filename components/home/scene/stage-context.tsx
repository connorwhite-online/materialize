"use client";

import {
  createContext,
  useContext,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_STAGE } from "./constants";

/**
 * Shared, re-render-free scene state.
 *
 * `stageRef` holds the eased stage value (0 → MAX_STAGE) that every
 * scene element reads inside its own useFrame. It is intentionally a
 * ref, not state — the scroll position changes every frame and we never
 * want React to re-render the canvas tree for it.
 *
 * React context does NOT cross the react-three-fiber reconciler
 * boundary automatically, so this provider is rendered *inside* the
 * <Canvas> (see scene-controller.tsx) and only consumed by canvas
 * children.
 */
interface StageState {
  /** Eased stage value the scene renders. */
  stageRef: MutableRefObject<number>;
  /** Disable idle motion / snap transitions for prefers-reduced-motion. */
  reducedMotion: boolean;
}

const StageContext = createContext<StageState | null>(null);

export function useStage(): StageState {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error("useStage must be used within <SceneController>");
  return ctx;
}

interface SceneControllerProps {
  /** Raw scroll progress in stage units, written by the DOM scroll handler. */
  progressRef: MutableRefObject<number>;
  reducedMotion: boolean;
  children: ReactNode;
}

/**
 * Eases the rendered `stage` toward the raw scroll `progress` each
 * frame and republishes it through context. Centralising the easing
 * here means a fast scroll/flick still produces a smooth morph rather
 * than snapping the scene between sections.
 */
export function SceneController({
  progressRef,
  reducedMotion,
  children,
}: SceneControllerProps) {
  const stageRef = useRef(0);

  useFrame((_, delta) => {
    const target = THREE.MathUtils.clamp(progressRef.current, 0, MAX_STAGE);
    if (reducedMotion) {
      stageRef.current = target;
      return;
    }
    // Critically-ish damped follow — quick enough to feel locked to the
    // scrollbar, soft enough to round off a flick.
    const t = 1 - Math.exp(-delta * 6.5);
    stageRef.current = THREE.MathUtils.lerp(stageRef.current, target, t);
  });

  return (
    <StageContext.Provider value={{ stageRef, reducedMotion }}>
      {children}
    </StageContext.Provider>
  );
}
