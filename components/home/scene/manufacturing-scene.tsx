"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";
import { type MaterialTarget } from "./device-model";
import { STAGE, stageWeight } from "./constants";

const GLOW = "#62d0ff";
// Scaled-down "on the print bed" size.
const S = 0.7;

/**
 * The manufacturing / supply-chain stage. The two outer enclosures sit
 * on a pedestal-like print bed lit dramatically from below, and
 * "print" from bottom to top: below the build line they're the solid
 * selected material; above it they're a digital wireframe glow. The
 * build line sweeps up as the reader scrolls into the section. Uses
 * world-space clipping planes (localClippingEnabled is set on the
 * renderer in HomeScene).
 */
export function ManufacturingScene({ target }: { target: MaterialTarget }) {
  const { stageRef, reducedMotion } = useStage();
  const { front, back, size } = useDeviceGeometry();

  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const solidA = useRef<THREE.MeshPhysicalMaterial>(null);
  const solidB = useRef<THREE.MeshPhysicalMaterial>(null);
  const up1 = useRef<THREE.PointLight>(null);
  const up2 = useRef<THREE.PointLight>(null);

  const planeBelow = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const planeAbove = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  const devBottom = (-S * size.y) / 2;
  const devHeight = S * size.y;
  const halfW = (S * size.x) / 2;

  const lerpSolid = (m: THREE.MeshPhysicalMaterial | null, dt: number) => {
    if (!m) return;
    const k = 1 - Math.exp(-dt * 4);
    m.color.lerp(target.color, k);
    m.metalness = THREE.MathUtils.lerp(m.metalness, target.metalness, k);
    m.roughness = THREE.MathUtils.lerp(m.roughness, target.roughness, k);
    m.clearcoat = THREE.MathUtils.lerp(m.clearcoat, target.clearcoat, k);
  };

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const stage = stageRef.current;
    const w = stageWeight(stage, STAGE.MATERIALS);
    g.visible = w > 0.01;

    // Build line sweeps up as you scroll into the section.
    const build = THREE.MathUtils.clamp((stage - 0.58) / 0.4, 0, 1);
    const buildY = devBottom + build * devHeight;
    planeBelow.constant = buildY;
    planeAbove.constant = -buildY;

    if (ringRef.current) {
      ringRef.current.position.y = buildY;
      ringRef.current.visible = build > 0.02 && build < 0.985;
    }

    lerpSolid(solidA.current, delta);
    lerpSolid(solidB.current, delta);

    if (spinRef.current && !reducedMotion) spinRef.current.rotation.y += delta * 0.25;

    // Fade everything with the stage; uplights only burn in this section.
    g.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as
        | (THREE.Material & { opacity: number; wireframe?: boolean })
        | undefined;
      if (!m || typeof m.opacity !== "number") return;
      m.opacity = m.wireframe ? w * 0.55 : w;
    });
    if (up1.current) up1.current.intensity = w * 16;
    if (up2.current) up2.current.intensity = w * 10;
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Dramatic upward lights — bottom of the platform is lost in glare. */}
      <pointLight ref={up1} position={[0.5, devBottom - 0.25, 0.5]} color="#bfe4ff" intensity={0} distance={4} />
      <pointLight ref={up2} position={[-0.5, devBottom - 0.25, 0.2]} color="#ffffff" intensity={0} distance={4} />

      {/* Pedestal / print bed (its base falls off into darkness). */}
      <mesh position={[0, devBottom - 0.85, 0]}>
        <cylinderGeometry args={[halfW * 1.7, halfW * 2.0, 1.6, 48]} />
        <meshStandardMaterial color="#16181d" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, devBottom - 0.045, 0]}>
        <cylinderGeometry args={[halfW * 1.7, halfW * 1.7, 0.02, 48]} />
        <meshBasicMaterial color={GLOW} toneMapped={false} transparent opacity={0.5} />
      </mesh>

      {/* The two outer enclosures: solid below the build line, wireframe above. */}
      <group ref={spinRef} scale={S}>
        <mesh geometry={front}>
          <meshPhysicalMaterial
            ref={solidA}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            clippingPlanes={[planeBelow]}
          />
        </mesh>
        <mesh geometry={back}>
          <meshPhysicalMaterial
            ref={solidB}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            clippingPlanes={[planeBelow]}
          />
        </mesh>
        <mesh geometry={front}>
          <meshBasicMaterial color={GLOW} wireframe transparent opacity={0.5} depthWrite={false} toneMapped={false} clippingPlanes={[planeAbove]} />
        </mesh>
        <mesh geometry={back}>
          <meshBasicMaterial color={GLOW} wireframe transparent opacity={0.5} depthWrite={false} toneMapped={false} clippingPlanes={[planeAbove]} />
        </mesh>
      </group>

      {/* The build line — a glowing print head ring. */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[halfW * 1.12, 0.01, 8, 64]} />
        <meshBasicMaterial color={GLOW} toneMapped={false} />
      </mesh>
    </group>
  );
}
