"use client";

import { useEffect, useRef } from "react";
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

/** Warm corrugated cardboard — matte, a little clearcoat for studio catch. */
const CARDBOARD = {
  color: "#c89655",
  metalness: 0,
  roughness: 0.82,
  clearcoat: 0.12,
  clearcoatRoughness: 0.55,
} as const;

const TAPE = {
  color: "#f0e2c0",
  metalness: 0,
  roughness: 0.55,
} as const;

const GORE_COLORS = ["#e24b4b", "#f4efe6", "#3d6b9a", "#e24b4b", "#f4efe6", "#3d6b9a"];

function ParachuteCanopy() {
  return (
    <group position={[0, 0.95, 0]}>
      {GORE_COLORS.map((color, i) => (
        <mesh key={i} castShadow={false}>
          <sphereGeometry
            args={[
              0.72,
              10,
              14,
              (i * Math.PI * 2) / GORE_COLORS.length,
              (Math.PI * 2) / GORE_COLORS.length,
              0,
              Math.PI / 2,
            ]}
          />
          <meshPhysicalMaterial
            color={color}
            roughness={0.42}
            metalness={0}
            side={THREE.DoubleSide}
            clearcoat={0.2}
            clearcoatRoughness={0.4}
          />
        </mesh>
      ))}
      {/* Soft rim ring so the canopy edge reads against the background. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <torusGeometry args={[0.7, 0.018, 8, 48]} />
        <meshPhysicalMaterial
          color="#c9a06a"
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
}

function ParachuteStrings() {
  // Four strings from canopy rim down to the box top corners.
  const anchors: Array<[number, number]> = [
    [-0.48, -0.48],
    [-0.48, 0.48],
    [0.48, -0.48],
    [0.48, 0.48],
  ];
  return (
    <group>
      {anchors.map(([x, z], i) => {
        const start = new THREE.Vector3(x * 1.1, 0.95, z * 1.1);
        const end = new THREE.Vector3(x * 0.55, 0.28, z * 0.55);
        const mid = start.clone().lerp(end, 0.5);
        const len = start.distanceTo(end);
        const dir = end.clone().sub(start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir
        );
        return (
          <mesh
            key={i}
            position={mid.toArray()}
            quaternion={quat}
          >
            <cylinderGeometry args={[0.008, 0.008, len, 6]} />
            <meshPhysicalMaterial
              color="#8a7355"
              roughness={0.7}
              metalness={0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function CardboardBox() {
  return (
    <group position={[0, -0.05, 0]}>
      <RoundedBox
        args={[0.95, 0.72, 0.95]}
        radius={0.14}
        smoothness={5}
        bevelSegments={3}
      >
        <meshPhysicalMaterial
          color={CARDBOARD.color}
          metalness={CARDBOARD.metalness}
          roughness={CARDBOARD.roughness}
          clearcoat={CARDBOARD.clearcoat}
          clearcoatRoughness={CARDBOARD.clearcoatRoughness}
          envMapIntensity={0.85}
        />
      </RoundedBox>
      {/* Packing tape down the middle of the top face. */}
      <RoundedBox
        args={[0.16, 0.74, 0.96]}
        radius={0.02}
        smoothness={2}
        position={[0, 0.01, 0]}
      >
        <meshPhysicalMaterial
          color={TAPE.color}
          metalness={TAPE.metalness}
          roughness={TAPE.roughness}
        />
      </RoundedBox>
      {/* Soft label sticker */}
      <RoundedBox
        args={[0.42, 0.28, 0.02]}
        radius={0.03}
        smoothness={2}
        position={[0, 0.02, 0.485]}
      >
        <meshPhysicalMaterial
          color="#f7f1e4"
          roughness={0.65}
          metalness={0}
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
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const restX = 0.18;
  const restY = -0.35;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = restX;
      g.rotation.y = restY;
      g.rotation.z = 0.04;
      g.position.y = 0.02;
      return;
    }
    const t = state.clock.elapsedTime;
    // Gentle parachute bob + sway; pointer nudges the tilt.
    const hoverX = restX - state.pointer.y * 0.14;
    const hoverY = restY + state.pointer.x * 0.22;
    const idleX = Math.sin(t * 0.7) * 0.05;
    const idleY = Math.sin(t * 0.45) * 0.08;
    const bob = Math.sin(t * 1.15) * 0.045;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = Math.sin(t * 0.6) * 0.05;
    g.position.y = THREE.MathUtils.lerp(g.position.y, 0.02 + bob, 0.1);
  });

  return (
    <group ref={group} rotation={[restX, restY, 0.04]} position={[0, 0.02, 0]}>
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
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 6, 4]} intensity={1.15} />
      <directionalLight position={[-4, -2, -4]} intensity={0.45} />
      <directionalLight position={[0, -4, 2]} intensity={0.28} />
      <StudioEnvironment />
      <DropRig paused={paused}>
        <ParachuteCanopy />
        <ParachuteStrings />
        <CardboardBox />
      </DropRig>
      <ContactShadows
        position={[0, -0.72, 0]}
        opacity={0.3}
        scale={3.4}
        blur={2.6}
        far={1.6}
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
      camera={{ position: [0, 0.15, 2.6], fov: 32 }}
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: true,
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
