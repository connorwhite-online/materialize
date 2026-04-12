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

    // Drag velocity → squash/stretch distortion
    const dragVel = dragVelocityRef.current;
    const stretchX = 1 + dragVel * 0.12;
    const squashY = 1 - Math.abs(dragVel) * 0.08;
    const squashZ = 1 - Math.abs(dragVel) * 0.04;

    // Smooth toward target scale
    const scaleLerp = 1 - Math.exp(-delta * 12);
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

    // Slight tilt in drag direction
    const tiltTarget = dragVel * 0.15;
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      tiltTarget,
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
