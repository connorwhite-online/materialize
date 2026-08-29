"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";

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
 *
 * Lit with local lights only (no in-memory PMREM / studio IBL). The
 * fee card needs IBL for titanium; these toys read as volume from fat
 * geometry + hard key light, and the Environment path has been a
 * blank-canvas failure mode on software GL.
 */

const WALL = "#fff8f0";
const ROOF = "#6b4a3a";
const DOOR = "#d62828";
const CHIMNEY = "#8a5a48";
const WINDOW = "#b8d4e8";
const KNOB = "#f0d78c";

function ChunkyHouse() {
  return (
    <group>
      <RoundedBox args={[1.25, 0.95, 1.1]} radius={0.2} smoothness={3}>
        <meshStandardMaterial color={WALL} roughness={0.7} metalness={0} />
      </RoundedBox>

      <mesh position={[0, 0.78, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.0, 0.7, 4]} />
        <meshStandardMaterial color={ROOF} roughness={0.65} metalness={0} flatShading />
      </mesh>

      <RoundedBox
        args={[0.3, 0.42, 0.3]}
        radius={0.06}
        smoothness={2}
        position={[0.38, 0.95, -0.08]}
      >
        <meshStandardMaterial color={CHIMNEY} roughness={0.75} metalness={0} />
      </RoundedBox>

      <RoundedBox
        args={[0.38, 0.58, 0.14]}
        radius={0.09}
        smoothness={2}
        position={[0, -0.14, 0.56]}
      >
        <meshStandardMaterial color={DOOR} roughness={0.45} metalness={0.05} />
      </RoundedBox>
      <mesh position={[0.11, -0.14, 0.65]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color={KNOB} roughness={0.3} metalness={0.7} />
      </mesh>

      <RoundedBox
        args={[0.28, 0.28, 0.1]}
        radius={0.06}
        smoothness={2}
        position={[-0.36, 0.12, 0.56]}
      >
        <meshStandardMaterial color={WINDOW} roughness={0.25} metalness={0.1} />
      </RoundedBox>
      <RoundedBox
        args={[0.28, 0.28, 0.1]}
        radius={0.06}
        smoothness={2}
        position={[0.36, 0.12, 0.56]}
      >
        <meshStandardMaterial color={WINDOW} roughness={0.25} metalness={0.1} />
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
    <group ref={group} rotation={[restX, restY, 0.03]} position={[0, -0.22, 0]}>
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
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.55} />
      <directionalLight position={[0, -2, 4]} intensity={0.35} />
      <HomeRig paused={paused}>
        <ChunkyHouse />
      </HomeRig>
      <ContactShadows
        position={[0, -0.78, 0]}
        opacity={0.28}
        scale={3.4}
        blur={2.4}
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
      camera={{ position: [0, 0.15, 2.85], fov: 34 }}
      dpr={1}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "default",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      // Always pump frames — `demand` + reduced-motion can leave the
      // first paint stuck before ContactShadows settles.
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
