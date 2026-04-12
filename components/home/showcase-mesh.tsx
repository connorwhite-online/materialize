"use client";

import { useRef } from "react";
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
}

export function ShowcaseMesh({ target }: ShowcaseMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame((state, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    // Gentle idle rotation
    meshRef.current.rotation.y += delta * 0.15;
    meshRef.current.rotation.x += delta * 0.05;

    // Interpolate material properties toward target (smooth ~600ms)
    const lerpFactor = 1 - Math.exp(-delta * 4);

    materialRef.current.color.lerp(target.color, lerpFactor);
    materialRef.current.metalness = THREE.MathUtils.lerp(
      materialRef.current.metalness,
      target.metalness,
      lerpFactor
    );
    materialRef.current.roughness = THREE.MathUtils.lerp(
      materialRef.current.roughness,
      target.roughness,
      lerpFactor
    );
    materialRef.current.clearcoat = THREE.MathUtils.lerp(
      materialRef.current.clearcoat,
      target.clearcoat,
      lerpFactor
    );
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <icosahedronGeometry args={[1.2, 4]} />
      <meshPhysicalMaterial
        ref={materialRef}
        color={target.color}
        metalness={target.metalness}
        roughness={target.roughness}
        clearcoat={target.clearcoat}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
}
