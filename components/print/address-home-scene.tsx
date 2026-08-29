"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { StudioEnvironment } from "@/components/viewer/studio-environment";

/**
 * Fire onReady only after the first successful painted frame —
 * same ReadySignal contract as payment-card-scene / shipping-drop-scene.
 */
function ReadySignal({
  onReady,
  onFail,
}: {
  onReady?: () => void;
  onFail?: () => void;
}) {
  const signaled = useRef(false);
  useFrame(({ gl }) => {
    if (signaled.current) return;
    if (gl.getContext().isContextLost()) {
      signaled.current = true;
      onFail?.();
      return;
    }
    signaled.current = true;
    onReady?.();
  });
  return null;
}

/**
 * Playmobil-scale house: five fat parts. Body, 4-sided roof,
 * chimney stub, red door, two window pads. No mailbox / smoke /
 * stoop — those read as illustration, not a toy.
 */

const WALL = {
  color: "#fff8f0",
  metalness: 0,
  roughness: 0.7,
  clearcoat: 0.15,
  clearcoatRoughness: 0.5,
} as const;

const ROOF = {
  color: "#6b4a3a",
  metalness: 0.04,
  roughness: 0.6,
} as const;

const DOOR = {
  color: "#d62828",
  metalness: 0.06,
  roughness: 0.45,
  clearcoat: 0.3,
  clearcoatRoughness: 0.35,
} as const;

function ChunkyHouse() {
  return (
    <group>
      <RoundedBox args={[1.4, 1.05, 1.2]} radius={0.22} smoothness={3}>
        <meshPhysicalMaterial
          color={WALL.color}
          metalness={WALL.metalness}
          roughness={WALL.roughness}
          clearcoat={WALL.clearcoat}
          clearcoatRoughness={WALL.clearcoatRoughness}
          envMapIntensity={0.9}
        />
      </RoundedBox>

      <mesh position={[0, 0.88, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.1, 0.78, 4]} />
        <meshPhysicalMaterial
          color={ROOF.color}
          metalness={ROOF.metalness}
          roughness={ROOF.roughness}
          flatShading
        />
      </mesh>

      <RoundedBox
        args={[0.34, 0.48, 0.34]}
        radius={0.07}
        smoothness={2}
        position={[0.42, 1.05, -0.1]}
      >
        <meshPhysicalMaterial color="#8a5a48" roughness={0.7} metalness={0} />
      </RoundedBox>

      <RoundedBox
        args={[0.42, 0.64, 0.16]}
        radius={0.1}
        smoothness={2}
        position={[0, -0.16, 0.6]}
      >
        <meshPhysicalMaterial
          color={DOOR.color}
          metalness={DOOR.metalness}
          roughness={DOOR.roughness}
          clearcoat={DOOR.clearcoat}
          clearcoatRoughness={DOOR.clearcoatRoughness}
        />
      </RoundedBox>
      <mesh position={[0.12, -0.16, 0.7]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshPhysicalMaterial
          color="#f0d78c"
          metalness={0.8}
          roughness={0.3}
        />
      </mesh>

      <RoundedBox
        args={[0.3, 0.3, 0.12]}
        radius={0.07}
        smoothness={2}
        position={[-0.4, 0.14, 0.6]}
      >
        <meshPhysicalMaterial
          color="#b8d4e8"
          metalness={0.12}
          roughness={0.25}
          clearcoat={0.4}
        />
      </RoundedBox>
      <RoundedBox
        args={[0.3, 0.3, 0.12]}
        radius={0.07}
        smoothness={2}
        position={[0.4, 0.14, 0.6]}
      >
        <meshPhysicalMaterial
          color="#b8d4e8"
          metalness={0.12}
          roughness={0.25}
          clearcoat={0.4}
        />
      </RoundedBox>
    </group>
  );
}

function HomeRig({
  paused,
  children,
}: {
  paused: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const restX = 0.18;
  const restY = -0.42;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = restX;
      g.rotation.y = restY;
      g.rotation.z = 0.03;
      return;
    }
    const t = state.clock.elapsedTime;
    const hoverX = restX - state.pointer.y * 0.14;
    const hoverY = restY + state.pointer.x * 0.24;
    const idleX = Math.sin(t * 0.55) * 0.035;
    const idleY = Math.sin(t * 0.4) * 0.05;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = 0.03;
  });

  return (
    <group ref={group} rotation={[restX, restY, 0.03]} position={[0, -0.12, 0]}>
      {children}
    </group>
  );
}

function Scene({ paused }: { paused: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (paused) invalidate();
  }, [paused, invalidate]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 6, 4]} intensity={1.35} />
      <directionalLight position={[-4, -2, -3]} intensity={0.45} />
      <directionalLight position={[0, -3, 3]} intensity={0.3} />
      <StudioEnvironment />
      <HomeRig paused={paused}>
        <ChunkyHouse />
      </HomeRig>
      <ContactShadows
        position={[0, -0.78, 0]}
        opacity={0.3}
        scale={3.4}
        blur={2.6}
        far={1.6}
      />
    </>
  );
}

export function AddressHomeScene({
  onReady,
  onFail,
}: {
  onReady?: () => void;
  onFail?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const paused = Boolean(reducedMotion);
  return (
    <Canvas
      camera={{ position: [0, 0.2, 2.35], fov: 32 }}
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      frameloop={paused ? "demand" : "always"}
      onCreated={({ gl }) => {
        const el = gl.domElement;
        el.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            onFail?.();
          },
          false
        );
      }}
    >
      <ReadySignal onReady={onReady} onFail={onFail} />
      <Scene paused={paused} />
    </Canvas>
  );
}
