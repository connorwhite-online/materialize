"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 450;
const PARTICLE_LIFETIME = 0.8;
const BASE_RADIUS = 1.2;

interface ShowcaseParticlesProps {
  burstKey: number;
  direction: number; // -1 (left) or 1 (right)
  color: THREE.Color;
}

/**
 * Instanced particle burst — spawns on burstKey change.
 * Particles scatter along the canonical X axis (swipe direction),
 * not toward the camera. Small and numerous for a fine dust effect.
 */
export function ShowcaseParticles({
  burstKey,
  direction,
  color,
}: ShowcaseParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const particles = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: PARTICLE_LIFETIME + 1,
      scale: 0,
      rotation: new THREE.Vector3(),
      rotationSpeed: new THREE.Vector3(),
    }));
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (burstKey === 0) return;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];

      // Sample a point on a sphere (approximate icosahedron surface)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = BASE_RADIUS + (Math.random() - 0.5) * 0.1;
      p.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      // Velocity primarily along X axis in the swipe direction
      // Small Y variance for natural dispersal, minimal Z
      p.velocity.set(
        direction * (2.0 + Math.random() * 2.5),
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.3
      );

      p.age = 0;
      // Tiny particles — 0.01 to 0.025
      p.scale = 0.01 + Math.random() * 0.015;

      // Random rotation for tumbling
      p.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      p.rotationSpeed.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      );
    }
  }, [burstKey, direction, particles]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.age += delta;

      if (p.age >= PARTICLE_LIFETIME) {
        dummy.position.set(0, 0, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      p.position.addScaledVector(p.velocity, delta);
      p.velocity.multiplyScalar(0.94);

      p.rotation.x += p.rotationSpeed.x * delta;
      p.rotation.y += p.rotationSpeed.y * delta;
      p.rotation.z += p.rotationSpeed.z * delta;

      const lifeT = p.age / PARTICLE_LIFETIME;
      const scale = p.scale * (1 - Math.pow(lifeT, 2));

      dummy.position.copy(p.position);
      dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, PARTICLE_COUNT]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
    </instancedMesh>
  );
}
