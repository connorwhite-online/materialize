"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";

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
 *
 * Local lights only — see address-home-scene for why we skip
 * studio IBL on these sheet toys.
 */

const CARDBOARD = "#c89655";
const TAPE = "#f0e2c0";
const CANOPY = "#e24b4b";
const RIM = "#f4efe6";
const STRING = "#8a7355";

function ChunkyCanopy() {
  // Sit the dome just above the box so the whole toy fits the sheet
  // hero frame — a taller stack clipped the canopy out of view.
  return (
    <group position={[0, 0.55, 0]}>
      <mesh>
        <sphereGeometry args={[0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={CANOPY}
          roughness={0.5}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <torusGeometry args={[0.7, 0.065, 8, 20]} />
        <meshStandardMaterial color={RIM} roughness={0.55} metalness={0} />
      </mesh>
    </group>
  );
}

function ChunkyStrings() {
  const anchors: Array<[number, number]> = [
    [0, -0.55],
    [-0.48, 0.28],
    [0.48, 0.28],
  ];
  return (
    <group>
      {anchors.map(([x, z], i) => {
        const start = new THREE.Vector3(x, 0.55, z);
        const end = new THREE.Vector3(x * 0.35, 0.18, z * 0.35);
        const mid = start.clone().lerp(end, 0.5);
        const len = start.distanceTo(end);
        const dir = end.clone().sub(start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir
        );
        return (
          <mesh key={i} position={mid.toArray()} quaternion={quat}>
            <cylinderGeometry args={[0.028, 0.028, len, 8]} />
            <meshStandardMaterial color={STRING} roughness={0.8} metalness={0} />
          </mesh>
        );
      })}
    </group>
  );
}

function ChunkyBox() {
  return (
    <group position={[0, -0.22, 0]}>
      <RoundedBox args={[1.05, 0.8, 1.05]} radius={0.2} smoothness={3}>
        <meshStandardMaterial color={CARDBOARD} roughness={0.85} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[0.24, 0.82, 1.07]}
        radius={0.05}
        smoothness={2}
        position={[0, 0.01, 0]}
      >
        <meshStandardMaterial color={TAPE} roughness={0.55} metalness={0} />
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
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 6, 5]} intensity={1.55} />
      <directionalLight position={[-5, 2, -4]} intensity={0.55} />
      <directionalLight position={[0, -3, 3]} intensity={0.35} />
      <DropRig paused={paused}>
        <ChunkyCanopy />
        <ChunkyStrings />
        <ChunkyBox />
      </DropRig>
      <ContactShadows
        position={[0, -0.72, 0]}
        opacity={0.26}
        scale={3.6}
        blur={2.6}
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
      camera={{ position: [0, 0.05, 2.7], fov: 34 }}
      dpr={1}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "default",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      frameloop="always"
      style={{ width: "100%", height: "100%" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        const el = gl.domElement;
        el.style.width = "100%";
        el.style.height = "100%";
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
