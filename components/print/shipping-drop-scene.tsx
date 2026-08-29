"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { StudioEnvironment } from "@/components/viewer/studio-environment";

/**
 * Fire onReady only after the first successful painted frame.
 * Same ReadySignal contract as payment-card-scene — onCreated's rAF
 * is too early on SwiftShader.
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
 * Playmobil-scale drop: one fat hemisphere, three cords, one round
 * box. A single canopy reads as a toy; sliced gores read as a drawing.
 */

const CARDBOARD = {
  color: "#c89655",
  metalness: 0,
  roughness: 0.82,
  clearcoat: 0.1,
  clearcoatRoughness: 0.6,
} as const;

const TAPE = {
  color: "#f0e2c0",
  metalness: 0,
  roughness: 0.55,
} as const;

const CANOPY = "#e24b4b";

function ChunkyCanopy() {
  return (
    <group position={[0, 0.92, 0]}>
      <mesh>
        <sphereGeometry args={[0.82, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          color={CANOPY}
          roughness={0.45}
          metalness={0}
          side={THREE.DoubleSide}
          clearcoat={0.15}
          clearcoatRoughness={0.45}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <torusGeometry args={[0.8, 0.07, 8, 20]} />
        <meshPhysicalMaterial
          color="#f4efe6"
          roughness={0.5}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

function ChunkyStrings() {
  const anchors: Array<[number, number]> = [
    [0, -0.62],
    [-0.54, 0.32],
    [0.54, 0.32],
  ];
  return (
    <group>
      {anchors.map(([x, z], i) => {
        const start = new THREE.Vector3(x, 0.92, z);
        const end = new THREE.Vector3(x * 0.4, 0.28, z * 0.4);
        const mid = start.clone().lerp(end, 0.5);
        const len = start.distanceTo(end);
        const dir = end.clone().sub(start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir
        );
        return (
          <mesh key={i} position={mid.toArray()} quaternion={quat}>
            <cylinderGeometry args={[0.03, 0.03, len, 8]} />
            <meshPhysicalMaterial
              color="#8a7355"
              roughness={0.75}
              metalness={0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function ChunkyBox() {
  return (
    <group position={[0, -0.08, 0]}>
      <RoundedBox args={[1.15, 0.88, 1.15]} radius={0.22} smoothness={3}>
        <meshPhysicalMaterial
          color={CARDBOARD.color}
          metalness={CARDBOARD.metalness}
          roughness={CARDBOARD.roughness}
          clearcoat={CARDBOARD.clearcoat}
          clearcoatRoughness={CARDBOARD.clearcoatRoughness}
          envMapIntensity={0.8}
        />
      </RoundedBox>
      <RoundedBox
        args={[0.26, 0.9, 1.17]}
        radius={0.05}
        smoothness={2}
        position={[0, 0.01, 0]}
      >
        <meshPhysicalMaterial
          color={TAPE.color}
          metalness={TAPE.metalness}
          roughness={TAPE.roughness}
        />
      </RoundedBox>
    </group>
  );
}

function DropRig({
  paused,
  children,
}: {
  paused: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const restX = 0.18;
  const restY = -0.38;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = restX;
      g.rotation.y = restY;
      g.rotation.z = 0.04;
      g.position.y = 0;
      return;
    }
    const t = state.clock.elapsedTime;
    const hoverX = restX - state.pointer.y * 0.12;
    const hoverY = restY + state.pointer.x * 0.2;
    const idleX = Math.sin(t * 0.7) * 0.04;
    const idleY = Math.sin(t * 0.45) * 0.07;
    const bob = Math.sin(t * 1.1) * 0.04;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = Math.sin(t * 0.6) * 0.045;
    g.position.y = THREE.MathUtils.lerp(g.position.y, bob, 0.1);
  });

  return (
    <group ref={group} rotation={[restX, restY, 0.04]} position={[0, 0, 0]}>
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
      <directionalLight position={[5, 6, 4]} intensity={1.3} />
      <directionalLight position={[-4, -2, -4]} intensity={0.5} />
      <directionalLight position={[0, -4, 2]} intensity={0.3} />
      <StudioEnvironment />
      <DropRig paused={paused}>
        <ChunkyCanopy />
        <ChunkyStrings />
        <ChunkyBox />
      </DropRig>
      <ContactShadows
        position={[0, -0.72, 0]}
        opacity={0.28}
        scale={3.6}
        blur={2.8}
        far={1.7}
      />
    </>
  );
}

export function ShippingDropScene({
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
      camera={{ position: [0, 0.15, 2.45], fov: 32 }}
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
