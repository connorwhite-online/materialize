"use client";

import { useState, useMemo, useRef, Suspense, useCallback, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { MATERIALS } from "@/lib/materials";
import { ShowcaseMesh } from "./showcase-mesh";
import { ShowcaseParticles } from "./showcase-particles";
import { MaterialCarousel } from "./material-carousel";

export function HeroShowcase() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [burstDirection, setBurstDirection] = useState(0);
  const [burstIntensity, setBurstIntensity] = useState(1);

  // Shared drag velocity — drives both mesh distortion and carousel scroll
  // Positive = swiping right (finger moves right, content moves right too)
  const dragVelocityRef = useRef(0);
  const [, forceUpdate] = useState({});

  // Ref to the carousel's scrollable track
  const carouselTrackRef = useRef<HTMLDivElement>(null);

  const material = MATERIALS[selectedIndex];

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
      // Particles fly in the direction the finger moved.
      // direction: +1 = next item (finger moved left), -1 = prev item (finger moved right)
      // Invert so particles fly with the finger.
      setBurstDirection(-direction);
      setBurstIntensity(intensity);
      setBurstKey((k) => k + 1);
    },
    []
  );

  // --- Unified pointer capture ---
  const dragStateRef = useRef<{
    active: boolean;
    lastX: number;
    lastTime: number;
    totalDelta: number;
    peakVelocity: number;
  }>({
    active: false,
    lastX: 0,
    lastTime: 0,
    totalDelta: 0,
    peakVelocity: 0,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStateRef.current = {
      active: true,
      lastX: e.clientX,
      lastTime: performance.now(),
      totalDelta: 0,
      peakVelocity: 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active) return;

    const dx = e.clientX - state.lastX;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);

    state.totalDelta += dx;
    state.lastX = e.clientX;
    state.lastTime = now;

    // Drive carousel scroll — scroll opposite to finger direction
    if (carouselTrackRef.current) {
      carouselTrackRef.current.scrollLeft -= dx;
    }

    // Velocity for mesh distortion (normalized -1..1, positive = finger right)
    const vel = Math.max(-1, Math.min(1, (dx / dt) * 20));
    dragVelocityRef.current = vel;

    // Track peak velocity during this drag
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

    // Determine target index from current scroll position and snap
    if (carouselTrackRef.current) {
      const track = carouselTrackRef.current;
      const trackCenter = track.scrollLeft + track.offsetWidth / 2;
      let closestIndex = 0;
      let closestDistance = Infinity;
      for (let i = 0; i < track.children.length; i++) {
        const item = track.children[i] as HTMLElement;
        const itemCenter = item.offsetLeft + item.offsetWidth / 2;
        const distance = Math.abs(trackCenter - itemCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      }

      if (closestIndex !== selectedIndex) {
        const direction = closestIndex > selectedIndex ? 1 : -1;
        // Use peak velocity from the drag — not the instantaneous velocity
        // at release (which is often near 0 as the finger slows down)
        const intensity = 0.3 + state.peakVelocity * 1.2;
        handleSelect(closestIndex, direction, intensity);
      } else {
        // Snap back to current if no change
        const item = track.children[selectedIndex] as HTMLElement | undefined;
        if (item) {
          const targetScroll =
            item.offsetLeft + item.offsetWidth / 2 - track.offsetWidth / 2;
          track.scrollTo({ left: targetScroll, behavior: "smooth" });
        }
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
      className="flex flex-col items-center gap-4 touch-none cursor-grab active:cursor-grabbing"
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
          <Suspense fallback={null}>
            <ambientLight intensity={0.4} />
            <directionalLight position={[5, 5, 5]} intensity={0.8} />
            <directionalLight position={[-5, -3, -5]} intensity={0.3} />
            <Environment preset="studio" />
            <ShowcaseMesh target={target} dragVelocityRef={dragVelocityRef} />
            <ShowcaseParticles
              burstKey={burstKey}
              direction={burstDirection}
              intensity={burstIntensity}
              color={particleColor}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* Material carousel — ref forwarded so parent can drive scroll */}
      <MaterialCarousel
        ref={carouselTrackRef}
        materials={MATERIALS}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
      />
    </div>
  );
}
