"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
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
  DROPZONE_PYRAMID_HEIGHT,
  DROPZONE_PYRAMID_RADIUS,
  DROPZONE_PYRAMID_SIDES,
  DROPZONE_SQUARE_RADIUS,
  DROPZONE_LOOKS,
  type DropzoneLookId,
  type DropzonePrimitive,
} from "./dropzone-looks";

function PhysicalSkin({
  lookId,
  flatShading = false,
}: {
  lookId: DropzoneLookId;
  /** Hard facets so the pyramid reads as a solid, not a soft cone. */
  flatShading?: boolean;
}) {
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
      flatShading={flatShading}
    />
  );
}

function PrimitiveBody({ spec }: { spec: DropzonePrimitive }) {
  switch (spec.kind) {
    case "roundedBox":
      return (
        <RoundedBox
          args={[1, 1, 1]}
          radius={DROPZONE_SQUARE_RADIUS}
          smoothness={6}
          bevelSegments={4}
        >
          <PhysicalSkin lookId={spec.look} />
        </RoundedBox>
      );
    case "pyramid":
      // 4 radial segments → square pyramid (4 triangular sides + base).
      // flatShading keeps facet edges hard so it doesn't shade into a cone.
      return (
        <mesh>
          <coneGeometry
            args={[
              DROPZONE_PYRAMID_RADIUS,
              DROPZONE_PYRAMID_HEIGHT,
              DROPZONE_PYRAMID_SIDES,
            ]}
          />
          <PhysicalSkin lookId={spec.look} flatShading />
        </mesh>
      );
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[0.56, 48, 48]} />
          <PhysicalSkin lookId={spec.look} />
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

function Scene({ paused }: { paused: boolean }) {
  return (
    <>
      {/* Same key/fill/rim as the marketing hero so stainless, resin,
          and nylon read the way they do on the torus, not as unlit
          gray blobs. */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <directionalLight position={[-5, -3, -5]} intensity={0.5} />
      <directionalLight position={[0, -5, 2]} intensity={0.3} />
      <StudioEnvironment />
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
    </>
  );
}

/**
 * Floating print-material primitives behind the authed-home file
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
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "low-power",
            toneMapping: THREE.ACESFilmicToneMapping,
          }}
          frameloop={paused ? "demand" : "always"}
        >
          <Scene paused={paused} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
