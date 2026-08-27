"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Outlines, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DropzonePrimitivesFallback } from "./dropzone-primitives-fallback";
import {
  DROPZONE_PRIMITIVES,
  type DropzoneLookId,
  type DropzonePrimitive,
} from "./dropzone-looks";
import { makeRoundedTriangleGeometry } from "./rounded-triangle";
import {
  DROPZONE_MOBILE_MAX_WIDTH,
  DROPZONE_MOBILE_POSITION,
  DROPZONE_MOBILE_SCALE,
  DROPZONE_SQUARE_RADIUS,
  TOON_INK,
  TOON_OUTLINE_THICKNESS,
} from "./dropzone-toon";
import { DropzoneToonMaterial } from "./dropzone-toon-material";

function ToonSkin({ lookId }: { lookId: DropzoneLookId }) {
  return (
    <>
      <DropzoneToonMaterial lookId={lookId} />
      <Outlines
        screenspace
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
          radius={DROPZONE_SQUARE_RADIUS}
          smoothness={6}
          bevelSegments={4}
        >
          {skin}
        </RoundedBox>
      );
    case "roundedTriangle":
      return <RoundedTriangle>{skin}</RoundedTriangle>;
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[0.56, 40, 40]} />
          {skin}
        </mesh>
      );
  }
}

function RoundedTriangle({ children }: { children: React.ReactNode }) {
  const geometry = useMemo(() => makeRoundedTriangleGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}>{children}</mesh>;
}

function useDropzoneLayout() {
  const { size } = useThree();
  const mobile = size.width < DROPZONE_MOBILE_MAX_WIDTH;
  return {
    mobile,
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
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
    </>
  );
}

/**
 * Floating flat-sketch primitives behind the authed-home file dropzone.
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
