"use client";

import { useState, useMemo, useRef, Suspense, useCallback, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { FEATURED_MATERIALS } from "@/lib/materials";
import { ShowcaseMesh } from "./showcase-mesh";
import { ShowcaseParticles } from "./showcase-particles";
import { MaterialCarousel } from "./material-carousel";

// Minimum horizontal drag distance (px) to register as a swipe
const SWIPE_THRESHOLD = 30;
// Vertical drag tolerance — cancel if vertical movement exceeds this
const VERTICAL_CANCEL = 40;

export function HeroShowcase() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [burstDirection, setBurstDirection] = useState(0);
  const [burstIntensity, setBurstIntensity] = useState(1);

  // Shared drag velocity — drives both mesh distortion and carousel scroll
  const dragVelocityRef = useRef(0);
  const [, forceUpdate] = useState({});

  const carouselTrackRef = useRef<HTMLDivElement>(null);

  const material = FEATURED_MATERIALS[selectedIndex];

  const target = useMemo(
    () => ({
      color: new THREE.Color(material.color),
      metalness: material.pbr.metalness,
      roughness: material.pbr.roughness,
      clearcoat: material.pbr.clearcoat ?? 0,
    }),
    [material]
  );

  const particleColor = useMemo(
    () => new THREE.Color(material.color),
    [material]
  );

  const handleSelect = useCallback(
    (index: number, direction: number, intensity: number = 1) => {
      setSelectedIndex(index);
      // Particles fly with the finger (invert the index-direction)
      setBurstDirection(-direction);
      setBurstIntensity(intensity);
      setBurstKey((k) => k + 1);
    },
    []
  );

  // --- Unified pointer capture ---
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastTime: number;
    peakVelocity: number;
    cancelled: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    peakVelocity: 0,
    cancelled: false,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastTime: performance.now(),
      peakVelocity: 0,
      cancelled: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active || state.cancelled) return;

    const totalDx = e.clientX - state.startX;
    const totalDy = e.clientY - state.startY;

    // Cancel if movement is mostly vertical
    if (Math.abs(totalDy) > VERTICAL_CANCEL && Math.abs(totalDy) > Math.abs(totalDx)) {
      state.cancelled = true;
      dragVelocityRef.current = 0;
      forceUpdate({});
      return;
    }

    const dx = e.clientX - state.lastX;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);

    state.lastX = e.clientX;
    state.lastTime = now;

    // Velocity for mesh distortion (normalized -1..1, positive = finger right)
    const vel = Math.max(-1, Math.min(1, (dx / dt) * 20));
    dragVelocityRef.current = vel;

    // Track peak velocity
    if (Math.abs(vel) > state.peakVelocity) {
      state.peakVelocity = Math.abs(vel);
    }

    forceUpdate({});
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active) return;
    state.active = false;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (state.cancelled) {
      dragVelocityRef.current = 0;
      forceUpdate({});
      return;
    }

    // One-step gesture: if horizontal distance > threshold, move ±1 index
    const totalDx = e.clientX - state.startX;
    if (Math.abs(totalDx) > SWIPE_THRESHOLD) {
      // Finger right (positive dx) → previous item (direction -1)
      // Finger left (negative dx) → next item (direction +1)
      const direction = totalDx > 0 ? -1 : 1;
      const newIndex = Math.max(
        0,
        Math.min(FEATURED_MATERIALS.length - 1, selectedIndex + direction)
      );
      if (newIndex !== selectedIndex) {
        const intensity = 0.3 + state.peakVelocity * 1.2;
        handleSelect(newIndex, direction, intensity);
      }
    }

    // Decay velocity
    dragVelocityRef.current = 0;
    forceUpdate({});
  };

  // Smooth velocity decay after release
  useEffect(() => {
    if (dragStateRef.current.active) return;
    if (Math.abs(dragVelocityRef.current) < 0.01) return;
    const id = requestAnimationFrame(() => {
      dragVelocityRef.current *= 0.88;
      if (Math.abs(dragVelocityRef.current) < 0.01) {
        dragVelocityRef.current = 0;
      }
      forceUpdate({});
    });
    return () => cancelAnimationFrame(id);
  });

  return (
    <div
      className="flex flex-col items-center gap-4 touch-pan-y cursor-grab active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 3D viewport */}
      <div className="relative w-full h-[320px] sm:h-[400px]">
        <Canvas
          camera={{ position: [0, 0, 4.5], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
        >
          {/* Lights render immediately — no Suspense */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <directionalLight position={[-5, -3, -5]} intensity={0.5} />
          <directionalLight position={[0, -5, 2]} intensity={0.3} />

          {/* Environment isolated in its own Suspense so it doesn't block the mesh */}
          <Suspense fallback={null}>
            <Environment preset="studio" />
          </Suspense>

          {/* Mesh + particles render immediately */}
          <ShowcaseMesh target={target} dragVelocityRef={dragVelocityRef} />
          <ShowcaseParticles
            burstKey={burstKey}
            direction={burstDirection}
            intensity={burstIntensity}
            color={particleColor}
          />
        </Canvas>
      </div>

      {/* Material carousel — display-only, driven by parent state */}
      <MaterialCarousel
        ref={carouselTrackRef}
        materials={FEATURED_MATERIALS}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
      />
    </div>
  );
}
