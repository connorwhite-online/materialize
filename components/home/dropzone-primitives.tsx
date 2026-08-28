"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  RoundedBox,
} from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { ErrorBoundary } from "@/components/ui/error-boundary";
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

/**
 * Local studio IBL at higher PMREM resolution than the shared
 * `StudioEnvironment` (256). The dropzone canvas is short; low-res
 * cubemaps wash metals and resin into chalk.
 */
function DropzoneEnvironment() {
  return (
    <Environment resolution={512}>
      <Lightformer
        form="rect"
        intensity={3.2}
        position={[0, 2.5, 4]}
        scale={[8, 8, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.35}
        position={[-5, 0, 1]}
        scale={[3, 8, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.35}
        position={[5, 0, 1]}
        scale={[3, 8, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.1}
        position={[0, 1, -5]}
        scale={[8, 6, 1]}
      />
      <Lightformer
        form="ring"
        intensity={0.55}
        position={[0, -4, 0]}
        scale={[10, 10, 1]}
      />
    </Environment>
  );
}

function PhysicalSkin({ lookId }: { lookId: DropzoneLookId }) {
  const look = DROPZONE_LOOKS[lookId];
  const transmitting = (look.transmission ?? 0) > 0;
  // A touch of clearcoat on the solids keeps them from reading as
  // matte chalk once the IBL is sharper.
  const clearcoat =
    look.clearcoat ?? (look.metalness > 0.5 ? 0.45 : 0.12);
  const clearcoatRoughness =
    look.clearcoatRoughness ?? (look.metalness > 0.5 ? 0.18 : 0.35);
  return (
    <meshPhysicalMaterial
      color={look.color}
      metalness={look.metalness}
      roughness={look.roughness}
      clearcoat={clearcoat}
      clearcoatRoughness={clearcoatRoughness}
      transmission={look.transmission ?? 0}
      ior={look.ior ?? 1.5}
      thickness={look.thickness ?? 0.5}
      transparent={transmitting}
      envMapIntensity={1.25}
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
          smoothness={10}
          bevelSegments={8}
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

/**
 * Tight soft pool under one shape. Parent is translation-only so the
 * disc stays upright while the mesh tumbles — cleaner than one noisy
 * floor across the short well.
 */
function PrimitiveContactShadow() {
  return (
    <ContactShadows
      position={[0, -0.58, 0]}
      scale={2.05}
      far={1.55}
      near={0}
      opacity={0.3}
      blur={2.5}
      resolution={512}
      color={SHADOW_COLOR}
      frames={Infinity}
      smooth
    />
  );
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
  const rootRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const { scaleMul, posMul } = useDropzoneLayout();
  const x = spec.position[0] * posMul * (viewport.width / 2);
  const y = spec.position[1] * posMul * (viewport.height / 2);
  const scale = spec.scale * scaleMul;

  const rest = spec.restRotation ?? [
    spec.phase * 0.4,
    spec.phase * 0.7,
    spec.phase * 0.2,
  ];

  useFrame(({ clock }) => {
    const root = rootRef.current;
    const mesh = meshRef.current;
    if (!root || !mesh || paused) return;
    const t = clock.elapsedTime;
    root.position.x = spec.position[0] * posMul * (viewport.width / 2);
    root.position.y =
      spec.position[1] * posMul * (viewport.height / 2) +
      Math.sin(t * spec.floatSpeed + spec.phase) * spec.floatAmp * scaleMul;
    mesh.rotation.x = rest[0] + t * spec.rotSpeed[0];
    mesh.rotation.y = rest[1] + t * spec.rotSpeed[1];
    mesh.rotation.z = rest[2] + t * spec.rotSpeed[2];
  });

  return (
    <group
      ref={rootRef}
      position={[x, y, spec.position[2]]}
      scale={scale}
    >
      <group ref={meshRef} rotation={[rest[0], rest[1], rest[2]]}>
        <PrimitiveBody spec={spec} />
      </group>
      <PrimitiveContactShadow />
    </group>
  );
}

function Scene({ paused }: { paused: boolean }) {
  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[4.5, 5.5, 5]} intensity={1.15} />
      <directionalLight position={[-4.5, -2.5, -4]} intensity={0.4} />
      <directionalLight position={[0, -4, 2.5]} intensity={0.28} />
      <DropzoneEnvironment />
      {DROPZONE_PRIMITIVES.map((spec) => (
        <PrimitiveMesh key={spec.look} spec={spec} paused={paused} />
      ))}
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
            powerPreference: "default",
            toneMapping: THREE.ACESFilmicToneMapping,
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.08;
          }}
          frameloop={paused ? "demand" : "always"}
        >
          <Scene paused={paused} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
