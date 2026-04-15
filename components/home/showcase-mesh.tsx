"use client";

import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface MaterialTarget {
  color: THREE.Color;
  metalness: number;
  roughness: number;
  clearcoat: number;
  transmission: number;
  ior: number;
  thickness: number;
}

interface ShowcaseMeshProps {
  target: MaterialTarget;
  dragVelocityRef: MutableRefObject<number>;
}

export function ShowcaseMesh({ target, dragVelocityRef }: ShowcaseMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  // Velocity refs for spring-physics integration of position.x and
  // rotation.z. Damped harmonic oscillators give a natural overshoot
  // when the drag releases (target snaps to 0) instead of a flat
  // ease-out.
  const swayVelRef = useRef(0);
  const tiltVelRef = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current || !meshRef.current || !materialRef.current) return;

    // Gentle idle rotation
    meshRef.current.rotation.y += delta * 0.15;
    meshRef.current.rotation.x += delta * 0.05;

    // Spring-tensioned drag: dragVelocityRef is already a tanh-shaped
    // displacement in [-1, 1] driven by total finger offset, so we don't
    // re-curve it here — the asymptote IS the increasing resistance.
    // The stretch coefficients are tuned to read as a meaningful
    // taffy-pull at full tension without snapping out of the silhouette.
    const tension = dragVelocityRef.current;
    const absT = Math.abs(tension);
    const stretchX = 1 + absT * 0.22;
    const squashY = 1 - absT * 0.12;
    const squashZ = 1 - absT * 0.06;

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

    // Sway and tilt use a damped-harmonic-oscillator integration
    // instead of a flat exponential ease so the release snap-back
    // overshoots once and settles. The targets follow the tanh-shaped
    // tension during the drag, then jump to 0 when the user lets go,
    // and the spring naturally bounces through the equilibrium.
    const swayTarget = tension * 0.4;
    const tiltTarget = tension * 0.12;
    // Tight spring — high stiffness for a fast oscillation, damping
    // tuned to ~0.5 critical so the snap-back overshoots once and
    // settles within ~250ms.
    const stiffness = 700;
    const dampingCoef = 26;

    const swayDx = swayTarget - groupRef.current.position.x;
    swayVelRef.current +=
      (swayDx * stiffness - swayVelRef.current * dampingCoef) * delta;
    groupRef.current.position.x += swayVelRef.current * delta;

    const tiltDx = tiltTarget - groupRef.current.rotation.z;
    tiltVelRef.current +=
      (tiltDx * stiffness - tiltVelRef.current * dampingCoef) * delta;
    groupRef.current.rotation.z += tiltVelRef.current * delta;

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
    materialRef.current.transmission = THREE.MathUtils.lerp(
      materialRef.current.transmission,
      target.transmission,
      matLerp
    );
    materialRef.current.ior = THREE.MathUtils.lerp(
      materialRef.current.ior,
      target.ior,
      matLerp
    );
    materialRef.current.thickness = THREE.MathUtils.lerp(
      materialRef.current.thickness,
      target.thickness,
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
          transmission={target.transmission}
          ior={target.ior}
          thickness={target.thickness}
          transparent
        />
      </mesh>
    </group>
  );
}
