"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX_PARTICLES = 800;
const MIN_PARTICLES = 60;
const PARTICLE_LIFETIME = 0.55;
const BASE_RADIUS = 1.30;

interface ShowcaseParticlesProps {
  burstKey: number;
  direction: number; // -1 (left) or 1 (right)
  intensity: number; // 0.5 - 1.5, scales count and velocity
  color: THREE.Color;
}

/**
 * Instanced particle burst — spawns on burstKey change.
 * Scatter along X axis in swipe direction with slight angular variance.
 * Particle count and velocity scale with intensity (scroll velocity).
 */
export function ShowcaseParticles({
  burstKey,
  direction,
  intensity,
  color,
}: ShowcaseParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const particles = useMemo(() => {
    return Array.from({ length: MAX_PARTICLES }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: PARTICLE_LIFETIME + 1,
      scale: 0,
      rotation: new THREE.Vector3(),
      rotationSpeed: new THREE.Vector3(),
      active: false,
    }));
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (burstKey === 0) return;

    // Scale count with intensity using a sqrt curve so low velocities
    // produce noticeably fewer particles than fast flicks.
    // intensity 0.3 (slow) → ~260, 0.8 (medium) → ~560, 1.5 (fast) → 800
    const normalized = Math.min(1, intensity / 1.5);
    const curved = Math.sqrt(normalized); // easing for more dynamic range
    const count = Math.round(
      MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * curved
    );

    // Directional push strength scales with intensity
    const directionalPush = 0.8 + intensity * 1.05;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];

      if (i >= count) {
        p.active = false;
        continue;
      }
      p.active = true;

      // Sample a point on a sphere approximating the mesh surface
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = BASE_RADIUS + (Math.random() - 0.5) * 0.1;
      p.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      // Omnidirectional base velocity — every particle flies outward
      // from its surface position in a random direction
      const outX = Math.sin(phi) * Math.cos(theta);
      const outY = Math.sin(phi) * Math.sin(theta);
      const outZ = Math.cos(phi);
      const baseSpeed = 0.75 + Math.random() * 0.7;

      // Directional push in the swipe direction.
      const directionalWeight = Math.random() * Math.random();
      const directionalComponent =
        direction * directionalPush * (0.5 + directionalWeight);

      p.velocity.set(
        outX * baseSpeed + directionalComponent,
        outY * baseSpeed + (Math.random() - 0.5) * 0.8,
        outZ * baseSpeed * 0.4
      );

      p.age = 0;
      // Tiny particles — 0.004 to 0.013
      p.scale = 0.004 + Math.random() * 0.009;

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
  }, [burstKey, direction, intensity, particles]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];

      if (!p.active || p.age >= PARTICLE_LIFETIME) {
        dummy.position.set(0, 0, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      p.age += delta;
      p.position.addScaledVector(p.velocity, delta);
      // Lighter drag so particles carry their burst velocity further across
      // the same lifetime — reads as more motion without lingering longer.
      p.velocity.multiplyScalar(0.968);

      p.rotation.x += p.rotationSpeed.x * delta;
      p.rotation.y += p.rotationSpeed.y * delta;
      p.rotation.z += p.rotationSpeed.z * delta;

      const lifeT = p.age / PARTICLE_LIFETIME;
      // Hold full size until 40%, then ease out across the rest of the life
      const fade = lifeT < 0.4 ? 1 : 1 - Math.pow((lifeT - 0.4) / 0.6, 1.4);
      const scale = p.scale * fade;

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
      args={[undefined, undefined, MAX_PARTICLES]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
    </instancedMesh>
  );
}
