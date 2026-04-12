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

    // Drag velocity → stretch horizontally in swipe direction, flatten height
    // Apply a curve (pow 1.8) so small gestures barely distort and only
    // strong flicks show full squash/stretch.
    const dragVel = dragVelocityRef.current;
    const signedCurved = Math.sign(dragVel) * Math.pow(Math.abs(dragVel), 1.8);
    const absCurved = Math.abs(signedCurved);
    const stretchX = 1 + absCurved * 0.08;
    const squashY = 1 - absCurved * 0.06;
    const squashZ = 1 - absCurved * 0.02;

    // Smooth toward target scale. High coefficient so the mesh catches
    // up to brief high-velocity bursts before the velocity decays away —
    // with a slower lerp, fast scrolls would only half-deform before
    // recovering, which reads as a sluggish swell instead of a snap.
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

    // Slight tilt in drag direction (also curved for less sensitivity)
    const tiltTarget = signedCurved * 0.06;
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      tiltTarget,
      scaleLerp
    );

    // Sway in the drag direction (curved)
    const swayTarget = signedCurved * 0.2;
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
