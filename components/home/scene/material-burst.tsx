"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX_PARTICLES = 800;
const MIN_PARTICLES = 60;
const PARTICLE_LIFETIME = 0.55;
// Spawn on the device's bounding ellipsoid (≈ its half-extents) rather
// than a big sphere, so particles look shed from the surface by the
// swipe velocity instead of appearing in a halo around it.
const HALF_X = 0.72;
const HALF_Y = 0.5;
const HALF_Z = 0.32;

interface MaterialBurstProps {
  /** Bumped each time the hero carousel selection changes. */
  burstKey: number;
  /** Carousel step direction the spray flies with (-1 / +1). */
  direction: number;
  /** 0.3–1.5, scales particle count + velocity with swipe speed. */
  intensity: number;
  color: THREE.Color;
}

/**
 * Instanced particle spray fired on each hero material change — the
 * production hero flourish. Scatters outward from the device silhouette
 * with a directional push in the swipe direction; count and velocity
 * scale with swipe intensity. One recycled InstancedMesh.
 */
export function MaterialBurst({
  burstKey,
  direction,
  intensity,
  color,
}: MaterialBurstProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const particles = useMemo(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: PARTICLE_LIFETIME + 1,
        scale: 0,
        rotation: new THREE.Vector3(),
        rotationSpeed: new THREE.Vector3(),
        active: false,
      })),
    []
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (burstKey === 0) return;

    const normalized = Math.min(1, intensity / 1.5);
    const curved = Math.sqrt(normalized);
    const count = Math.round(MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * curved);
    const directionalPush = 0.8 + intensity * 1.05;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      if (i >= count) {
        p.active = false;
        continue;
      }
      p.active = true;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.sin(phi) * Math.sin(theta);
      const sz = Math.cos(phi);
      // Sit just on the device surface (tiny inward/outward jitter).
      const jitter = 0.95 + Math.random() * 0.1;
      p.position.set(sx * HALF_X * jitter, sy * HALF_Y * jitter, sz * HALF_Z * jitter);

      // Fly outward from the surface point.
      const inv = 1 / (Math.hypot(p.position.x, p.position.y, p.position.z) || 1);
      const outX = p.position.x * inv;
      const outY = p.position.y * inv;
      const outZ = p.position.z * inv;
      const baseSpeed = 0.6 + Math.random() * 0.6;
      const directionalWeight = Math.random() * Math.random();
      const directionalComponent = direction * directionalPush * (0.5 + directionalWeight);

      p.velocity.set(
        outX * baseSpeed + directionalComponent,
        outY * baseSpeed + (Math.random() - 0.5) * 0.8,
        outZ * baseSpeed * 0.4
      );

      p.age = 0;
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
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }
      p.age += delta;
      p.position.addScaledVector(p.velocity, delta);
      p.velocity.multiplyScalar(0.968);
      p.rotation.x += p.rotationSpeed.x * delta;
      p.rotation.y += p.rotationSpeed.y * delta;
      p.rotation.z += p.rotationSpeed.z * delta;

      const lifeT = p.age / PARTICLE_LIFETIME;
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
