"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Outlines, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DropzonePrimitivesFallback } from "./dropzone-primitives-fallback";
import {
  DROPZONE_LOOKS,
  DROPZONE_PRIMITIVES,
  type DropzoneLookId,
  type DropzonePrimitive,
} from "./dropzone-looks";
import { makeRoundedConeGeometry } from "./rounded-cone";
import { TOON_INK, TOON_OUTLINE_THICKNESS } from "./dropzone-toon";

function ToonSkin({ lookId }: { lookId: DropzoneLookId }) {
  const look = DROPZONE_LOOKS[lookId];
  return (
    <>
      <meshBasicMaterial color={look.color} toneMapped={false} />
      <Outlines
        thickness={TOON_OUTLINE_THICKNESS}
        color={TOON_INK}
        angle={Math.PI}
        toneMapped={false}
      />
    </>
  );
}

function PrimitiveBody({ spec }: { spec: DropzonePrimitive }) {
  const skin = <ToonSkin lookId={spec.look} />;
  switch (spec.kind) {
    case "roundedBox":
      return (
        <RoundedBox
          args={[1, 1, 1]}
          radius={0.28}
          smoothness={8}
          bevelSegments={6}
        >
          {skin}
        </RoundedBox>
      );
    case "roundedCone":
      return <RoundedCone>{skin}</RoundedCone>;
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[0.58, 48, 48]} />
          {skin}
        </mesh>
      );
  }
}

function RoundedCone({ children }: { children: React.ReactNode }) {
  const geometry = useMemo(() => makeRoundedConeGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}>{children}</mesh>;
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
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
    </>
  );
}

/**
 * Floating toon-ink primitives behind the authed-home file dropzone.
 * Decorative — `pointer-events` stay off so the file input remains
 * the only control. Pauses when scrolled off-screen or when the user
 * prefers reduced motion.
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
            toneMapping: THREE.NoToneMapping,
          }}
          frameloop={paused ? "demand" : "always"}
        >
          <Scene paused={paused} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
