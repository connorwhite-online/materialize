"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";

const MAX = 1200;
const LIFE = 0.95;
// Device half-extents (matches the shell footprint, a touch smaller to
// sit on the shrunk-in-materials device).
const HALF_X = 0.4;
const HALF_Y = 0.64;
const HALF_Z = 0.17;
// Scroll positions the two sprays trigger at. Direction-specific so each
// fires AS the material sheds/reforms, not after: scrolling down we shed
// right as the dissolve begins (~FADE_A); scrolling up we gather right as
// the hologram starts condensing back (~near FADE_B).
const T_SHED = 0.54;
const T_GATHER = 0.74;

type Mode = "shed" | "gather";

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  age: number;
  scale: number;
  mode: Mode;
  active: boolean;
}

/**
 * The material dissolve/condense spray fired on the carousel <-> hologram
 * transition. Scrolling DOWN (into manufacturing) the material explodes
 * off the surface and flows UP — the solid dissolving away to reveal the
 * hologram. Scrolling UP it does the opposite: particles are pulled back
 * onto the surface as if magnetically re-condensing into the material.
 * Edge-triggered off the eased stage value, denser than the hero burst.
 */
export function DissolveBurst({ color }: { color: THREE.Color }) {
  const { stageRef, reducedMotion } = useStage();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const prev = useRef<number | null>(null);
  const armedShed = useRef(true);
  const armedGather = useRef(false);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: MAX }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        target: new THREE.Vector3(),
        age: LIFE + 1,
        scale: 0,
        mode: "shed" as Mode,
        active: false,
      })),
    []
  );

  const fire = (mode: Mode) => {
    const count = mode === "shed" ? MAX : Math.round(MAX * 0.9);
    for (let i = 0; i < MAX; i++) {
      const p = particles[i];
      if (i >= count) {
        p.active = false;
        continue;
      }
      p.active = true;
      p.mode = mode;
      p.age = 0;
      p.scale = 0.004 + Math.random() * 0.011;

      // A point on the device surface ellipsoid.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.sin(phi) * Math.sin(theta);
      const sz = Math.cos(phi);
      const j = 0.9 + Math.random() * 0.2;
      const surfX = sx * HALF_X * j;
      const surfY = sy * HALF_Y * j;
      const surfZ = sz * HALF_Z * j;

      if (mode === "shed") {
        // Start on the surface, explode outward + strongly UPWARD.
        p.position.set(surfX, surfY, surfZ);
        const inv = 1 / (Math.hypot(surfX, surfY, surfZ) || 1);
        const up = 1.5 + Math.random() * 1.8;
        p.velocity.set(
          surfX * inv * 0.8 + (Math.random() - 0.5) * 0.6,
          Math.abs(surfY * inv) * 0.4 + up,
          surfZ * inv * 0.45 + (Math.random() - 0.5) * 0.3
        );
      } else {
        // Start spread out / up in the air, fly INWARD to the surface.
        p.target.set(surfX, surfY, surfZ);
        const spread = 1.4 + Math.random() * 1.6;
        p.position.set(
          surfX * 2.6 + (Math.random() - 0.5) * 1.3,
          surfY + spread,
          surfZ * 2.6 + (Math.random() - 0.5) * 1.3
        );
        p.velocity.copy(p.target).sub(p.position).multiplyScalar(1.5);
      }
    }
  };

  useFrame((_, delta) => {
    const stage = stageRef.current;
    // Edge-trigger the two sprays as the eased stage crosses the
    // carousel <-> hologram boundary, with hysteresis so a single scroll
    // fires once.
    if (prev.current !== null && !reducedMotion) {
      const a = prev.current;
      const b = stage;
      if (a <= T_SHED && b > T_SHED && armedShed.current) {
        fire("shed");
        armedShed.current = false;
        armedGather.current = true;
      }
      if (a >= T_GATHER && b < T_GATHER && armedGather.current) {
        fire("gather");
        armedGather.current = false;
        armedShed.current = true;
      }
    }
    if (stage < 0.45) armedShed.current = true;
    if (stage > 0.95) armedGather.current = true;
    prev.current = stage;

    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 1 / 30);
    for (let i = 0; i < MAX; i++) {
      const p = particles[i];
      if (!p.active || p.age >= LIFE) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      p.age += dt;
      if (p.mode === "shed") {
        p.position.addScaledVector(p.velocity, dt);
        p.velocity.multiplyScalar(0.965);
        p.velocity.y += dt * 0.5; // keep flowing upward
      } else {
        // Magnetic pull toward the surface target, easing in as it lands.
        p.position.addScaledVector(p.velocity, dt);
        p.velocity.multiplyScalar(0.9);
        p.velocity.addScaledVector(p.target.clone().sub(p.position), dt * 7);
      }

      const lifeT = p.age / LIFE;
      let fade: number;
      if (p.mode === "shed") {
        fade = lifeT < 0.3 ? 1 : 1 - Math.pow((lifeT - 0.3) / 0.7, 1.4);
      } else {
        // Pop in, then sink/fade as it condenses onto the surface.
        fade = lifeT < 0.65 ? Math.min(1, lifeT / 0.12) : 1 - (lifeT - 0.65) / 0.35;
      }
      const s = p.scale * Math.max(0, fade);

      dummy.position.copy(p.position);
      dummy.rotation.set(p.position.x * 5, p.position.y * 5, p.position.z * 5);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
    </instancedMesh>
  );
}
