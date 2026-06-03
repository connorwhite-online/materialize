"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX_PARTICLES = 600;
const PARTICLE_LIFETIME = 0.6;
const BASE_RADIUS = 0.95;

interface MaterialBurstProps {
  /** Bumped each time the hero carousel selection changes. */
  burstKey: number;
  color: THREE.Color;
}

/**
 * Instanced particle spray that fires from the device silhouette each
 * time the hero material changes — the flourish that used to live in
 * the old HeroShowcase. Omnidirectional outward burst with a quick
 * fade. Cheap: one InstancedMesh, recycled.
 */
export function MaterialBurst({ burstKey, color }: MaterialBurstProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const particles = useMemo(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: PARTICLE_LIFETIME + 1,
        scale: 0,
        active: false,
      })),
    []
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (burstKey === 0) return;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      p.active = true;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = BASE_RADIUS + (Math.random() - 0.5) * 0.2;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.sin(phi) * Math.sin(theta);
      const sz = Math.cos(phi);
      p.position.set(r * sx, r * sy, r * sz);
      const speed = 0.9 + Math.random() * 0.8;
      p.velocity.set(sx * speed, sy * speed, sz * speed * 0.5);
      p.age = 0;
      p.scale = 0.006 + Math.random() * 0.012;
    }
  }, [burstKey, particles]);

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
      p.velocity.multiplyScalar(0.95);
      const lifeT = p.age / PARTICLE_LIFETIME;
      const fade = lifeT < 0.35 ? 1 : 1 - Math.pow((lifeT - 0.35) / 0.65, 1.4);
      const s = p.scale * fade;
      dummy.position.copy(p.position);
      dummy.scale.set(s, s, s);
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
