"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DropzonePrimitivesFallback } from "./dropzone-primitives-fallback";
import {
  DROPZONE_LOOKS,
  DROPZONE_PRIMITIVES,
  type DropzoneLookId,
  type DropzonePrimitive,
} from "./dropzone-looks";

function LookMaterial({ lookId }: { lookId: DropzoneLookId }) {
  const look = DROPZONE_LOOKS[lookId];
  const transmissive = (look.transmission ?? 0) > 0;
  return (
    <meshPhysicalMaterial
      color={look.color}
      metalness={look.metalness}
      roughness={look.roughness}
      clearcoat={look.clearcoat ?? 0}
      clearcoatRoughness={0.12}
      transmission={look.transmission ?? 0}
      ior={look.ior ?? 1.5}
      thickness={look.thickness ?? 0.4}
      transparent={transmissive}
    />
  );
}

function PrimitiveBody({ spec }: { spec: DropzonePrimitive }) {
  const material = <LookMaterial lookId={spec.look} />;
  switch (spec.kind) {
    case "roundedBox":
      return (
        <RoundedBox
          args={[1, 1, 1]}
          radius={0.28}
          smoothness={8}
          bevelSegments={6}
        >
          {material}
        </RoundedBox>
      );
    case "roundedSlab":
      return (
        <RoundedBox
          args={[1.25, 0.72, 1.25]}
          radius={0.24}
          smoothness={8}
          bevelSegments={6}
        >
          {material}
        </RoundedBox>
      );
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[0.58, 48, 48]} />
          {material}
        </mesh>
      );
  }
}

function PrimitiveMesh({
  spec,
  paused,
}: {
  spec: DropzonePrimitive;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || paused) return;
    const t = clock.elapsedTime;
    group.position.y =
      spec.position[1] + Math.sin(t * spec.floatSpeed + spec.phase) * spec.floatAmp;
    group.rotation.x = spec.phase * 0.4 + t * spec.rotSpeed[0];
    group.rotation.y = spec.phase * 0.7 + t * spec.rotSpeed[1];
    group.rotation.z = spec.phase * 0.2 + t * spec.rotSpeed[2];
  });

  return (
    <group
      ref={groupRef}
      position={spec.position as [number, number, number]}
      scale={spec.scale}
      rotation={[spec.phase * 0.4, spec.phase * 0.7, spec.phase * 0.2]}
    >
      <PrimitiveBody spec={spec} />
    </group>
  );
}

function Scene({ paused }: { paused: boolean }) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 5, 6]} intensity={1.15} />
      <directionalLight position={[-5, -2, -4]} intensity={0.4} />
      <directionalLight position={[0, -4, 3]} intensity={0.25} />
      <StudioEnvironment />
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
    </>
  );
}

/**
 * Floating catalog-material primitives behind the authed-home file
 * dropzone. Decorative — `pointer-events` stay off so the file input
 * remains the only control. Pauses when scrolled off-screen or when
 * the user prefers reduced motion.
 */
export function DropzonePrimitives() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const reducedMotion = useReducedMotion();
  const paused = Boolean(reducedMotion) || !visible;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <ErrorBoundary fallback={<DropzonePrimitivesFallback />}>
        <Canvas
          camera={{ position: [0, 0.12, 6.5], fov: 28 }}
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "low-power",
          }}
          frameloop={paused ? "demand" : "always"}
        >
          <Scene paused={paused} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
