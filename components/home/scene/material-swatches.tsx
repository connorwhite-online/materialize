"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { DeviceModel, type MaterialTarget } from "./device-model";
import { SWATCH_MATERIALS, STAGE, stageWeight } from "./constants";

/** Soft radial blob used as a cheap contact shadow under each swatch. */
function makeShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.4)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface SwatchCardProps {
  index: number;
  shadowTex: THREE.CanvasTexture;
}

// Resting fan layout per card (index 0,1,2). Multiplied by the stage
// weight so the cards spread out of the centre during the transition in.
const FAN = [
  { x: -0.95, y: 0.18, z: 0.0, rot: 0.16 },
  { x: 0.0, y: -0.05, z: 0.45, rot: -0.02 },
  { x: 0.95, y: 0.1, z: -0.1, rot: -0.16 },
];

function SwatchCard({ index, shadowTex }: SwatchCardProps) {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const bobRef = useRef<THREE.Group>(null);
  const staticExplode = useRef(0);

  const material = SWATCH_MATERIALS[index];
  const target = useMemo<MaterialTarget>(
    () => ({
      color: new THREE.Color(material.color),
      metalness: material.pbr.metalness,
      roughness: material.pbr.roughness,
      clearcoat: material.pbr.clearcoat ?? 0,
      transmission: material.pbr.transmission ?? 0,
      ior: material.pbr.ior ?? 1.5,
      thickness: material.pbr.thickness ?? 0,
    }),
    [material]
  );

  const phase = index * 2.1;
  const fan = FAN[index];

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = stageWeight(stageRef.current, STAGE.MATERIALS);
    g.visible = w > 0.01;

    // Cards grow + fan out of the centre as the stage approaches.
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 7);
    const scale = 0.38 * w;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, scale, k));
    g.position.x = THREE.MathUtils.lerp(g.position.x, fan.x * w, k);
    g.position.y = THREE.MathUtils.lerp(g.position.y, fan.y * w, k);
    g.position.z = THREE.MathUtils.lerp(g.position.z, fan.z * w, k);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, fan.rot * w, k);

    // The whole swatch card bobs as a unit; the model inside stays put.
    if (bobRef.current) {
      bobRef.current.position.y = reducedMotion
        ? 0
        : Math.sin(state.clock.elapsedTime * 1.1 + phase) * 0.1;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Plate + shadow + model all bob together. */}
      <group ref={bobRef}>
        {/* Backdrop swatch plate. */}
        <RoundedBox args={[1.9, 2.3, 0.12]} radius={0.12} smoothness={4} position={[0, 0, -0.7]}>
          <meshStandardMaterial color="#f1ece1" metalness={0.05} roughness={0.85} />
        </RoundedBox>
        {/* Contact shadow on the plate. */}
        <mesh position={[0, -0.55, -0.62]}>
          <planeGeometry args={[1.6, 0.7]} />
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} opacity={0.8} />
        </mesh>
        {/* The same device, this material — held at a fixed 3/4 pose. */}
        <group rotation={[-0.32, 0.5, 0]}>
          <DeviceModel
            target={target}
            explodeRef={staticExplode}
            showInternals={false}
            castShadow={false}
          />
        </group>
      </group>
    </group>
  );
}

/** The three fanned, bobbing material swatches of the Materials stage. */
export function MaterialSwatches() {
  const shadowTex = useMemo(() => makeShadowTexture(), []);
  return (
    <group>
      {SWATCH_MATERIALS.map((_, i) => (
        <SwatchCard key={i} index={i} shadowTex={shadowTex} />
      ))}
    </group>
  );
}
