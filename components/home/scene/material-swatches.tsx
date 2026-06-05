"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { SWATCH_MATERIALS, STAGE, stageWeight } from "./constants";

// Resting fan layout per card (index 0,1,2), behind the shrunken
// device. Multiplied by the stage weight so they spread out of the
// centre as the section comes in.
const FAN = [
  { x: -1.05, y: 0.12, z: 0.1, rot: 0.22 },
  { x: 0.0, y: 0.28, z: -0.1, rot: 0.0 },
  { x: 1.05, y: 0.12, z: 0.1, rot: -0.22 },
];
// Push the whole fan behind the device.
const BASE_Z = -0.55;

interface SwatchCardProps {
  index: number;
}

/**
 * A physical material-sample card: a neutral plate with a recessed
 * chip of the actual material (its real PBR), like a swatch you'd hold.
 * The whole card bobs; the chip stays put inside it.
 */
function SwatchCard({ index }: SwatchCardProps) {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const bobRef = useRef<THREE.Group>(null);

  const m = SWATCH_MATERIALS[index];
  const fan = FAN[index];
  const phase = index * 2.1;

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = stageWeight(stageRef.current, STAGE.MATERIALS);
    g.visible = w > 0.01;

    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 7);
    const scale = 0.5 * w;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, scale, k));
    g.position.x = THREE.MathUtils.lerp(g.position.x, fan.x * w, k);
    g.position.y = THREE.MathUtils.lerp(g.position.y, fan.y * w, k);
    g.position.z = THREE.MathUtils.lerp(g.position.z, (BASE_Z + fan.z) * w, k);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, fan.rot * w, k);

    if (bobRef.current) {
      bobRef.current.position.y = reducedMotion
        ? 0
        : Math.sin(state.clock.elapsedTime * 1.1 + phase) * 0.06;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <group ref={bobRef}>
        {/* Card plate. */}
        <RoundedBox args={[1.5, 1.9, 0.14]} radius={0.12} smoothness={6}>
          <meshStandardMaterial color="#ece6da" metalness={0.04} roughness={0.85} />
        </RoundedBox>
        {/* Recessed frame ring around the chip. */}
        <RoundedBox args={[1.16, 1.5, 0.16]} radius={0.09} smoothness={5} position={[0, 0.06, 0.0]}>
          <meshStandardMaterial color="#d9d2c2" metalness={0.05} roughness={0.9} />
        </RoundedBox>
        {/* The actual material chip, recessed into the plate. */}
        <RoundedBox args={[1.04, 1.36, 0.12]} radius={0.06} smoothness={5} position={[0, 0.06, 0.0]}>
          <meshPhysicalMaterial
            color={m.color}
            metalness={m.pbr.metalness}
            roughness={m.pbr.roughness}
            clearcoat={m.pbr.clearcoat ?? 0}
            clearcoatRoughness={0.1}
            transmission={m.pbr.transmission ?? 0}
            ior={m.pbr.ior ?? 1.5}
            thickness={m.pbr.thickness ?? 0}
            transparent={(m.pbr.transmission ?? 0) > 0.02}
          />
        </RoundedBox>
      </group>
    </group>
  );
}

/** The three fanned material-sample cards of the Materials stage. */
export function MaterialSwatches() {
  return (
    <group>
      {SWATCH_MATERIALS.map((_, i) => (
        <SwatchCard key={i} index={i} />
      ))}
    </group>
  );
}
