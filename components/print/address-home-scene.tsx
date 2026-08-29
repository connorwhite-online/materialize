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

/** Fresh white paint — matte with a little studio catch. */
const WALL = {
  color: "#fff8f0",
  metalness: 0,
  roughness: 0.68,
  clearcoat: 0.22,
  clearcoatRoughness: 0.4,
} as const;

const ROOF = {
  color: "#6b4a3a",
  metalness: 0.05,
  roughness: 0.55,
} as const;

/** Saturated cartoon red — the front door is the whole joke. */
const DOOR = {
  color: "#d62828",
  metalness: 0.08,
  roughness: 0.38,
  clearcoat: 0.4,
  clearcoatRoughness: 0.28,
} as const;

const WINDOW_GLASS = {
  color: "#b8d4e8",
  metalness: 0.2,
  roughness: 0.15,
  clearcoat: 0.6,
  clearcoatRoughness: 0.2,
} as const;

const TRIM = "#efe8dc";
const GRASS = "#7cb07a";

function Roof() {
  // Two tilted slabs meeting as a simple gable — chubby cartoon, not CAD.
  return (
    <group position={[0, 0.55, 0]}>
      <mesh
        position={[-0.28, 0.05, 0]}
        rotation={[0, 0, 0.55]}
        castShadow={false}
      >
        <boxGeometry args={[0.95, 0.1, 1.05]} />
        <meshPhysicalMaterial
          color={ROOF.color}
          metalness={ROOF.metalness}
          roughness={ROOF.roughness}
        />
      </mesh>
      <mesh
        position={[0.28, 0.05, 0]}
        rotation={[0, 0, -0.55]}
        castShadow={false}
      >
        <boxGeometry args={[0.95, 0.1, 1.05]} />
        <meshPhysicalMaterial
          color={ROOF.color}
          metalness={ROOF.metalness}
          roughness={ROOF.roughness}
        />
      </mesh>
      <RoundedBox
        args={[0.12, 0.08, 1.08]}
        radius={0.03}
        smoothness={2}
        position={[0, 0.28, 0]}
      >
        <meshPhysicalMaterial color="#5c3b2e" roughness={0.5} metalness={0.05} />
      </RoundedBox>
    </group>
  );
}

function Chimney() {
  return (
    <group position={[0.42, 0.72, -0.15]}>
      <RoundedBox args={[0.22, 0.42, 0.22]} radius={0.03} smoothness={3}>
        <meshPhysicalMaterial color="#8a5a48" roughness={0.65} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[0.28, 0.08, 0.28]}
        radius={0.02}
        smoothness={2}
        position={[0, 0.22, 0]}
      >
        <meshPhysicalMaterial color="#5c3b2e" roughness={0.55} metalness={0} />
      </RoundedBox>
    </group>
  );
}

function Smoke({ paused }: { paused: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.children.forEach((child, i) => {
        child.position.set(0, 0.12 + i * 0.14, 0);
        child.scale.setScalar(1);
      });
      return;
    }
    const t = state.clock.elapsedTime;
    g.children.forEach((child, i) => {
      child.position.y = 0.12 + i * 0.14 + Math.sin(t * 1.15 + i) * 0.035;
      child.position.x = Math.sin(t * 0.7 + i * 0.9) * 0.045;
      const s = 1 + i * 0.18 + Math.sin(t * 1.3 + i) * 0.08;
      child.scale.setScalar(s);
    });
  });
  return (
    <group ref={group} position={[0.42, 1.02, -0.15]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.14, 0]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshPhysicalMaterial
            color="#f4f1ea"
            roughness={1}
            metalness={0}
            transparent
            opacity={0.42 - i * 0.1}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Window({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.26, 0.08, 0.1]} radius={0.02} position={[0, -0.16, 0.02]}>
        <meshPhysicalMaterial color="#c9a06a" roughness={0.7} metalness={0} />
      </RoundedBox>
      {([-0.07, 0, 0.07] as const).map((x, i) => (
        <mesh key={i} position={[x, -0.1, 0.04]}>
          <sphereGeometry args={[0.032, 10, 10]} />
          <meshPhysicalMaterial
            color={i === 1 ? "#f4d35e" : "#e24b4b"}
            roughness={0.45}
            metalness={0}
          />
        </mesh>
      ))}
      <RoundedBox args={[0.22, 0.22, 0.04]} radius={0.03} smoothness={2}>
        <meshPhysicalMaterial
          color={WINDOW_GLASS.color}
          metalness={WINDOW_GLASS.metalness}
          roughness={WINDOW_GLASS.roughness}
          clearcoat={WINDOW_GLASS.clearcoat}
          clearcoatRoughness={WINDOW_GLASS.clearcoatRoughness}
        />
      </RoundedBox>
      <mesh position={[0, 0, 0.022]}>
        <boxGeometry args={[0.02, 0.2, 0.01]} />
        <meshPhysicalMaterial color="#8aa8bc" roughness={0.5} metalness={0} />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <boxGeometry args={[0.2, 0.02, 0.01]} />
        <meshPhysicalMaterial color="#8aa8bc" roughness={0.5} metalness={0} />
      </mesh>
    </group>
  );
}

function FrontDoor() {
  return (
    <group position={[0, -0.16, 0.49]}>
      <RoundedBox args={[0.42, 0.68, 0.04]} radius={0.04} smoothness={3}>
        <meshPhysicalMaterial color={TRIM} roughness={0.7} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[0.32, 0.58, 0.06]}
        radius={0.04}
        smoothness={3}
        position={[0, 0, 0.02]}
      >
        <meshPhysicalMaterial
          color={DOOR.color}
          metalness={DOOR.metalness}
          roughness={DOOR.roughness}
          clearcoat={DOOR.clearcoat}
          clearcoatRoughness={DOOR.clearcoatRoughness}
        />
      </RoundedBox>
      <RoundedBox
        args={[0.2, 0.18, 0.02]}
        radius={0.02}
        smoothness={2}
        position={[0, 0.1, 0.055]}
      >
        <meshPhysicalMaterial color="#c41e1e" roughness={0.45} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[0.2, 0.18, 0.02]}
        radius={0.02}
        smoothness={2}
        position={[0, -0.12, 0.055]}
      >
        <meshPhysicalMaterial color="#c41e1e" roughness={0.45} metalness={0} />
      </RoundedBox>
      <mesh position={[0.1, 0, 0.06]}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshPhysicalMaterial
          color="#f0d78c"
          metalness={0.85}
          roughness={0.25}
          clearcoat={0.4}
        />
      </mesh>
    </group>
  );
}

function Stoop() {
  return (
    <group>
      <RoundedBox
        args={[0.55, 0.08, 0.28]}
        radius={0.03}
        smoothness={2}
        position={[0, -0.48, 0.58]}
      >
        <meshPhysicalMaterial color="#e8e2d6" roughness={0.75} metalness={0} />
      </RoundedBox>
      <RoundedBox
        args={[0.7, 0.06, 0.22]}
        radius={0.025}
        smoothness={2}
        position={[0, -0.54, 0.72]}
      >
        <meshPhysicalMaterial color="#ddd6c8" roughness={0.8} metalness={0} />
      </RoundedBox>
    </group>
  );
}

function Mailbox() {
  return (
    <group position={[-0.72, -0.32, 0.52]} rotation={[0, 0.35, 0]}>
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.28, 8]} />
        <meshPhysicalMaterial color="#c4b8a0" roughness={0.55} metalness={0.15} />
      </mesh>
      <RoundedBox args={[0.2, 0.11, 0.11]} radius={0.03} position={[0, 0.06, 0]}>
        <meshPhysicalMaterial color="#3d6b9a" roughness={0.45} metalness={0.1} />
      </RoundedBox>
      <mesh position={[0, 0.13, 0.02]}>
        <boxGeometry args={[0.07, 0.02, 0.012]} />
        <meshPhysicalMaterial color="#d62828" roughness={0.4} metalness={0} />
      </mesh>
    </group>
  );
}

function Lawn() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.575, 0.08]}>
      <circleGeometry args={[0.98, 32]} />
      <meshPhysicalMaterial color={GRASS} roughness={0.92} metalness={0} />
    </mesh>
  );
}

function GableWindow() {
  return (
    <group position={[0, 0.58, 0.36]}>
      <mesh rotation={[0.45, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.05, 20]} />
        <meshPhysicalMaterial
          color={WINDOW_GLASS.color}
          metalness={WINDOW_GLASS.metalness}
          roughness={WINDOW_GLASS.roughness}
          clearcoat={WINDOW_GLASS.clearcoat}
        />
      </mesh>
    </group>
  );
}

function HouseBody({ paused }: { paused: boolean }) {
  return (
    <group>
      <Lawn />
      <RoundedBox args={[1.05, 0.85, 0.95]} radius={0.12} smoothness={5}>
        <meshPhysicalMaterial
          color={WALL.color}
          metalness={WALL.metalness}
          roughness={WALL.roughness}
          clearcoat={WALL.clearcoat}
          clearcoatRoughness={WALL.clearcoatRoughness}
          envMapIntensity={0.9}
        />
      </RoundedBox>
      <FrontDoor />
      <Window position={[-0.32, 0.08, 0.48]} />
      <Window position={[0.32, 0.08, 0.48]} />
      <GableWindow />
      <Roof />
      <Chimney />
      <Smoke paused={paused} />
      <Stoop />
      <Mailbox />
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
  const restY = -0.38;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = restX;
      g.rotation.y = restY;
      g.rotation.z = 0.02;
      return;
    }
    const t = state.clock.elapsedTime;
    const hoverX = restX - state.pointer.y * 0.14;
    const hoverY = restY + state.pointer.x * 0.24;
    const idleX = Math.sin(t * 0.55) * 0.035;
    const idleY = Math.sin(t * 0.4) * 0.055;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = 0.02;
  });

  return (
    <group ref={group} rotation={[restX, restY, 0.02]} position={[0, -0.02, 0]}>
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
      <directionalLight position={[5, 6, 4]} intensity={1.2} />
      <directionalLight position={[-4, -2, -3]} intensity={0.4} />
      <directionalLight position={[0, -3, 3]} intensity={0.25} />
      <StudioEnvironment />
      <HomeRig paused={paused}>
        <HouseBody paused={paused} />
      </HomeRig>
      <ContactShadows
        position={[0, -0.68, 0]}
        opacity={0.3}
        scale={3.2}
        blur={2.5}
        far={1.5}
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
      camera={{ position: [0, 0.18, 2.7], fov: 32 }}
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
