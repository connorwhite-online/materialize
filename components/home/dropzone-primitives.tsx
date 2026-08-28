"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
import { DropzonePrimitivesFallback } from "./dropzone-primitives-fallback";
import {
  DROPZONE_MOBILE_MAX_WIDTH,
  DROPZONE_MOBILE_POSITION,
  DROPZONE_MOBILE_SCALE,
  DROPZONE_PRIMITIVES,
  DROPZONE_SQUARE_RADIUS,
  DROPZONE_LOOKS,
  type DropzoneLookId,
  type DropzonePrimitive,
} from "./dropzone-looks";
import { makeRoundedPyramidGeometry } from "./rounded-pyramid";

/** Warm near-black so soft contact pools read on light and dark wells
 *  without a cool cast. */
const SHADOW_COLOR = "#1c1916";

function PhysicalSkin({ lookId }: { lookId: DropzoneLookId }) {
  const look = DROPZONE_LOOKS[lookId];
  const transmitting = (look.transmission ?? 0) > 0;
  return (
    <meshPhysicalMaterial
      color={look.color}
      metalness={look.metalness}
      roughness={look.roughness}
      clearcoat={look.clearcoat ?? 0}
      clearcoatRoughness={look.clearcoatRoughness ?? 0.1}
      transmission={look.transmission ?? 0}
      ior={look.ior ?? 1.5}
      thickness={look.thickness ?? 0.5}
      transparent={transmitting}
      // Pull a bit more studio IBL so stainless/resin don't go chalky
      // in the small well.
      envMapIntensity={1.15}
    />
  );
}

function RoundedPyramid({ children }: { children: React.ReactNode }) {
  const geometry = useMemo(() => makeRoundedPyramidGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}>{children}</mesh>;
}

function PrimitiveBody({ spec }: { spec: DropzonePrimitive }) {
  const skin = <PhysicalSkin lookId={spec.look} />;
  switch (spec.kind) {
    case "roundedBox":
      return (
        <RoundedBox
          args={[1, 1, 1]}
          radius={DROPZONE_SQUARE_RADIUS}
          // Higher tessellation — low smoothness reads as faceted plastic
          // next to the resin sphere.
          smoothness={8}
          bevelSegments={6}
        >
          {skin}
        </RoundedBox>
      );
    case "pyramid":
      return <RoundedPyramid>{skin}</RoundedPyramid>;
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[0.56, 64, 64]} />
          {skin}
        </mesh>
      );
  }
}

function useDropzoneLayout() {
  const { size } = useThree();
  const mobile = size.width < DROPZONE_MOBILE_MAX_WIDTH;
  return {
    scaleMul: mobile ? DROPZONE_MOBILE_SCALE : 1,
    posMul: mobile ? DROPZONE_MOBILE_POSITION : 1,
  };
}

function PrimitiveMesh({
  spec,
  paused,
}: {
  spec: DropzonePrimitive;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const { scaleMul, posMul } = useDropzoneLayout();
  const x = spec.position[0] * posMul * (viewport.width / 2);
  const y = spec.position[1] * posMul * (viewport.height / 2);
  const scale = spec.scale * scaleMul;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || paused) return;
    const t = clock.elapsedTime;
    const rest = spec.restRotation ?? [
      spec.phase * 0.4,
      spec.phase * 0.7,
      spec.phase * 0.2,
    ];
    group.position.x = spec.position[0] * posMul * (viewport.width / 2);
    group.position.y =
      spec.position[1] * posMul * (viewport.height / 2) +
      Math.sin(t * spec.floatSpeed + spec.phase) * spec.floatAmp * scaleMul;
    group.rotation.x = rest[0] + t * spec.rotSpeed[0];
    group.rotation.y = rest[1] + t * spec.rotSpeed[1];
    group.rotation.z = rest[2] + t * spec.rotSpeed[2];
  });

  const rest = spec.restRotation ?? [
    spec.phase * 0.4,
    spec.phase * 0.7,
    spec.phase * 0.2,
  ];

  return (
    <group
      ref={groupRef}
      position={[x, y, spec.position[2]]}
      scale={scale}
      rotation={[rest[0], rest[1], rest[2]]}
    >
      <PrimitiveBody spec={spec} />
    </group>
  );
}

/**
 * Single soft contact pass under the set. Hard shadow-maps on a
 * transparent catcher read as aliased silhouettes; ContactShadows
 * alone darkens the card fill through the alpha canvas as clean
 * elliptical pools.
 */
function CardContactShadows() {
  const { viewport } = useThree();
  // Sit just under the lowest parked shape so each object gets a
  // tight pool without a giant floor slab across the well.
  const y = -viewport.height * 0.42;
  return (
    <ContactShadows
      position={[0, y, 0]}
      scale={Math.max(viewport.width * 1.35, 4.5)}
      far={2.4}
      near={0}
      opacity={0.38}
      blur={3.4}
      resolution={1024}
      color={SHADOW_COLOR}
      frames={Infinity}
      smooth
    />
  );
}

function Scene({ paused }: { paused: boolean }) {
  return (
    <>
      {/* Same key/fill/rim as the marketing hero — IBL carries the
          materials; directionals are fill only (no shadow maps). */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <directionalLight position={[-5, -3, -5]} intensity={0.5} />
      <directionalLight position={[0, -5, 2]} intensity={0.3} />
      <StudioEnvironment />
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
      <CardContactShadows />
    </>
  );
}

/**
 * Floating print-material primitives behind the featured file
 * dropzone — stainless, resin, nylon under studio IBL. Decorative;
 * `pointer-events` stay off so the file input remains the only
 * control. Pauses when scrolled off-screen or when the user prefers
 * reduced motion.
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
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.05;
          }}
          frameloop={paused ? "demand" : "always"}
        >
          <Scene paused={paused} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
