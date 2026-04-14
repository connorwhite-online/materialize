"use client";

import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface MaterialTarget {
  color: THREE.Color;
  metalness: number;
  roughness: number;
  clearcoat: number;
}

interface ShowcaseMeshProps {
  target: MaterialTarget;
  dragVelocityRef: MutableRefObject<number>;
}

export function ShowcaseMesh({ target, dragVelocityRef }: ShowcaseMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame((_, delta) => {
    if (!groupRef.current || !meshRef.current || !materialRef.current) return;

    // Gentle idle rotation
    meshRef.current.rotation.y += delta * 0.15;
    meshRef.current.rotation.x += delta * 0.05;

    // Spring-tensioned drag: dragVelocityRef is already a tanh-shaped
    // displacement in [-1, 1] driven by total finger offset, so we don't
    // re-curve it here — the asymptote IS the increasing resistance.
    const tension = dragVelocityRef.current;
    const absT = Math.abs(tension);
    const stretchX = 1 + absT * 0.07;
    const squashY = 1 - absT * 0.05;
    const squashZ = 1 - absT * 0.02;

    // Smooth toward target scale. High coefficient so the mesh catches
    // up to brief high-velocity bursts before the velocity decays away.
    const scaleLerp = 1 - Math.exp(-delta * 28);
    groupRef.current.scale.x = THREE.MathUtils.lerp(
      groupRef.current.scale.x,
      stretchX,
      scaleLerp
    );
    groupRef.current.scale.y = THREE.MathUtils.lerp(
      groupRef.current.scale.y,
      squashY,
      scaleLerp
    );
    groupRef.current.scale.z = THREE.MathUtils.lerp(
      groupRef.current.scale.z,
      squashZ,
      scaleLerp
    );

    const tiltTarget = tension * 0.06;
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      tiltTarget,
      scaleLerp
    );

    // Sway in the drag direction — follows finger with spring resistance.
    const swayTarget = tension * 0.18;
    groupRef.current.position.x = THREE.MathUtils.lerp(
      groupRef.current.position.x,
      swayTarget,
      scaleLerp
    );

    // Interpolate material properties toward target (smooth ~600ms)
    const matLerp = 1 - Math.exp(-delta * 4);
    materialRef.current.color.lerp(target.color, matLerp);
    materialRef.current.metalness = THREE.MathUtils.lerp(
      materialRef.current.metalness,
      target.metalness,
      matLerp
    );
    materialRef.current.roughness = THREE.MathUtils.lerp(
      materialRef.current.roughness,
      target.roughness,
      matLerp
    );
    materialRef.current.clearcoat = THREE.MathUtils.lerp(
      materialRef.current.clearcoat,
      target.clearcoat,
      matLerp
    );
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} castShadow receiveShadow>
        {/* Torus with high subdivision for smooth shading */}
        <torusGeometry args={[0.9, 0.38, 128, 256]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={target.color}
          metalness={target.metalness}
          roughness={target.roughness}
          clearcoat={target.clearcoat}
          clearcoatRoughness={0.1}
        />
      </mesh>
    </group>
  );
}
