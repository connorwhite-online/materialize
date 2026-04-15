"use client";

import { useState, useMemo, useRef, Suspense, useCallback, useEffect } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { HERO_MATERIALS } from "@/lib/materials";
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

  // Mirror state in a ref so event handlers always read the fresh value
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Shared drag velocity — drives mesh distortion
  const dragVelocityRef = useRef(0);
  const [, forceUpdate] = useState({});

  const containerRef = useRef<HTMLDivElement>(null);
  const carouselTrackRef = useRef<HTMLDivElement>(null);

  const material = HERO_MATERIALS[selectedIndex];

  const target = useMemo(
    () => ({
      color: new THREE.Color(material.color),
      metalness: material.pbr.metalness,
      roughness: material.pbr.roughness,
      clearcoat: material.pbr.clearcoat ?? 0,
      transmission: material.pbr.transmission ?? 0,
      ior: material.pbr.ior ?? 1.5,
      thickness: material.pbr.thickness ?? 0,
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
      // Particles fly WITH the gesture so the spray reads as motion in the
      // direction the user just dragged. `direction` is the carousel step
      // (-1 prev / +1 next), which is opposite the finger, so negate it.
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
    // Intentionally NOT calling setPointerCapture — that would intercept
    // click events on child buttons (the carousel items).
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

    // Position-based spring tension. tanh asymptotes toward ±1 so the
    // resistance grows as the finger pulls further — no hard clamp, no
    // bump-stop. 220px ≈ "fully tensioned".
    const tension = Math.tanh(totalDx / 220);
    dragVelocityRef.current = tension;

    // Track peak instantaneous velocity for burst intensity scaling.
    const instVel = Math.min(1, Math.abs((dx / dt) * 20));
    if (instVel > state.peakVelocity) {
      state.peakVelocity = instVel;
    }

    forceUpdate({});
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active) return;
    state.active = false;

    if (state.cancelled) {
      dragVelocityRef.current = 0;
      forceUpdate({});
      return;
    }

    // One-step gesture: if horizontal distance > threshold, move ±1 index
    const totalDx = e.clientX - state.startX;
    if (Math.abs(totalDx) > SWIPE_THRESHOLD) {
      const direction = totalDx > 0 ? -1 : 1;
      const currentIndex = selectedIndexRef.current;
      const newIndex = Math.max(
        0,
        Math.min(HERO_MATERIALS.length - 1, currentIndex + direction)
      );
      if (newIndex !== currentIndex) {
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
      dragVelocityRef.current *= 0.75;
      if (Math.abs(dragVelocityRef.current) < 0.01) {
        dragVelocityRef.current = 0;
      }
      forceUpdate({});
    });
    return () => cancelAnimationFrame(id);
  });

  // Native touchmove listener — prevents iOS edge swipe-back when dragging
  // horizontally. React's onTouchMove is passive by default and can't
  // preventDefault, so we attach a non-passive listener manually.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      dragStateRef.current.startX = touch.clientX;
      dragStateRef.current.startY = touch.clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStateRef.current.startX;
      const dy = touch.clientY - dragStateRef.current.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        e.preventDefault();
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex w-full flex-col items-center gap-1 cursor-grab active:cursor-grabbing"
      style={{ overscrollBehaviorX: "contain", touchAction: "pan-y" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 3D viewport — full-bleed on mobile so particles can fly off-screen */}
      <div className="relative -mx-4 w-[100vw] h-[300px] sm:mx-0 sm:w-full sm:h-[480px]">
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
        materials={HERO_MATERIALS}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
      />
    </div>
  );
}
