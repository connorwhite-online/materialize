"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX_PARTICLES = 700;
const MIN_PARTICLES = 200;
const PARTICLE_LIFETIME = 0.85;
const BASE_RADIUS = 1.2;

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

    // Scale count with intensity: 200 (slow) -> 700 (fast)
    const count = Math.round(
      MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * Math.min(1, intensity)
    );

    // Randomize base angle slightly for unique spray each burst (±12°)
    const baseAngleJitter = (Math.random() - 0.5) * 0.4;
    // Slight vertical bias — sometimes up, sometimes down
    const verticalBias = (Math.random() - 0.5) * 0.6;
    // Random spread angle (narrower for slow, wider for fast)
    const spread = 0.3 + intensity * 0.4;

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

      // Random angle within spray cone, centered on swipe direction
      const particleAngle =
        baseAngleJitter + (Math.random() - 0.5) * spread;
      const speedBase = 2.0 + intensity * 2.5;
      const speed = speedBase * (0.7 + Math.random() * 0.6);

      p.velocity.set(
        direction * speed * Math.cos(particleAngle),
        verticalBias + direction * speed * Math.sin(particleAngle) +
          (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.4
      );

      p.age = 0;
      p.scale = 0.01 + Math.random() * 0.015;

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
      args={[undefined, undefined, MAX_PARTICLES]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
    </instancedMesh>
  );
}
