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

  // Shared drag state — controls both carousel and mesh distortion
  // dragVelocity: -1..1 (negative = left, positive = right)
  const dragVelocityRef = useRef(0);
  const [, forceUpdate] = useState({});

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

  const handleSelect = useCallback((index: number, direction: number) => {
    setSelectedIndex(index);
    setBurstDirection(direction);
    setBurstKey((k) => k + 1);
  }, []);

  // Canvas drag-to-scroll handlers
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastTime: number;
    totalDelta: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    totalDelta: 0,
  });

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastTime: performance.now(),
      totalDelta: 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active) return;

    // Combine horizontal and vertical drag — both scroll the carousel
    const dx = e.clientX - state.lastX;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);

    state.totalDelta += dx;
    state.lastX = e.clientX;
    state.lastTime = now;

    // Instantaneous velocity for mesh distortion (-1 to 1)
    dragVelocityRef.current = Math.max(-1, Math.min(1, (dx / dt) * 20));
    forceUpdate({});
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active) return;
    state.active = false;

    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    // Snap to next/prev based on drag distance
    const threshold = 40;
    if (Math.abs(state.totalDelta) > threshold) {
      const direction = state.totalDelta < 0 ? 1 : -1;
      const newIndex = Math.max(
        0,
        Math.min(MATERIALS.length - 1, selectedIndex + direction)
      );
      if (newIndex !== selectedIndex) {
        handleSelect(newIndex, direction);
      }
    }

    // Decay velocity
    dragVelocityRef.current = 0;
    forceUpdate({});
  };

  // Smooth velocity decay when not dragging
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
    <div className="flex flex-col items-center gap-4">
      {/* 3D viewport — drag to scroll */}
      <div
        className="relative w-full h-[320px] sm:h-[400px] touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
      >
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
              color={particleColor}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* Material carousel */}
      <MaterialCarousel
        materials={MATERIALS}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
      />
    </div>
  );
}
