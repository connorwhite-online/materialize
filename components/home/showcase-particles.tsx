"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 180;
const PARTICLE_LIFETIME = 0.7; // seconds
const BASE_RADIUS = 1.2;

interface ShowcaseParticlesProps {
  // incremented each time a burst should happen
  burstKey: number;
  // unit direction vector for the burst (-1 to 1 on x)
  direction: number;
  // color of the emitting material
  color: THREE.Color;
}

/**
 * Instanced particle burst — spawns on burstKey change,
 * particles scatter in the given direction and fade out.
 */
export function ShowcaseParticles({
  burstKey,
  direction,
  color,
}: ShowcaseParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Per-particle state
  const particles = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: PARTICLE_LIFETIME + 1, // start dead
      scale: 0,
    }));
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // Spawn a burst when burstKey changes
  useEffect(() => {
    if (burstKey === 0) return; // skip initial render

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];

      // Sample a point on the mesh surface (roughly — use a random sphere surface)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = BASE_RADIUS + (Math.random() - 0.5) * 0.1;
      p.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      // Outward velocity biased in the swipe direction
      const outward = p.position.clone().normalize().multiplyScalar(0.8 + Math.random() * 0.6);
      outward.x += direction * (1.5 + Math.random() * 0.8);
      outward.y += (Math.random() - 0.5) * 0.4;
      outward.z += (Math.random() - 0.5) * 0.4;
      p.velocity.copy(outward);

      p.age = 0;
      p.scale = 0.04 + Math.random() * 0.04;
    }
  }, [burstKey, direction, particles]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.age += delta;

      if (p.age >= PARTICLE_LIFETIME) {
        // Hide dead particles by scaling to 0
        dummy.position.set(0, 0, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Advance position
      p.position.addScaledVector(p.velocity, delta);
      // Slight gravity/drift
      p.velocity.multiplyScalar(0.96);

      // Fade out via scale
      const lifeT = p.age / PARTICLE_LIFETIME;
      const scale = p.scale * (1 - lifeT * lifeT);

      dummy.position.copy(p.position);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;

    // Update instance color (all same)
    if (meshRef.current.instanceColor) {
      tmpColor.copy(color);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        meshRef.current.setColorAt(i, tmpColor);
      }
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, PARTICLE_COUNT]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        metalness={0.3}
        roughness={0.4}
        transparent
        opacity={0.9}
      />
    </instancedMesh>
  );
}
