"use client";

import { useState, useMemo, Suspense } from "react";
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

  const material = MATERIALS[selectedIndex];

  // Convert material to Three.js usable target
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

  const handleSelect = (index: number, direction: number) => {
    setSelectedIndex(index);
    setBurstDirection(direction);
    setBurstKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col items-center gap-4">
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
            <ShowcaseMesh target={target} />
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
