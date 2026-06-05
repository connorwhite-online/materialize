"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { STAGE } from "./constants";

const GLOW = "#6fd2ff";
const DUST = 150;

/** Vertical glow gradient: bright along the bottom edge, fading up and
 *  softening toward the sides so it reads as light welling up from the
 *  bottom of the frame rather than a hard rectangle. */
function makeGlowTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const v = x.createLinearGradient(0, S, 0, 0);
  v.addColorStop(0, "rgba(150,215,255,0.95)");
  v.addColorStop(0.35, "rgba(95,175,255,0.4)");
  v.addColorStop(1, "rgba(95,175,255,0)");
  x.fillStyle = v;
  x.fillRect(0, 0, S, S);
  // Soften the left/right edges.
  const hgrad = x.createLinearGradient(0, 0, S, 0);
  hgrad.addColorStop(0, "rgba(0,0,0,1)");
  hgrad.addColorStop(0.5, "rgba(0,0,0,0)");
  hgrad.addColorStop(1, "rgba(0,0,0,1)");
  x.globalCompositeOperation = "destination-out";
  x.fillStyle = hgrad;
  x.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round sprite for the floating dust motes. */
function makeDustTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(205,232,255,0.6)");
  g.addColorStop(1, "rgba(205,232,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/**
 * The manufacturing-stage atmosphere: a gentle blue glow welling up from
 * the bottom of the screen with dust motes drifting through it (replacing
 * the old print-bed pedestal). The device prints as a hologram floating
 * in this light. Everything is gated on the Materials stage and fades
 * sharply in/out so it's gone by the neighbouring stages.
 */
export function BuildGlow() {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const dustMat = useRef<THREE.PointsMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const upRef = useRef<THREE.PointLight>(null);

  const glowTex = useMemo(makeGlowTexture, []);
  const dustTex = useMemo(makeDustTexture, []);

  // Dust field: live positions plus per-mote base x/z, rise speed, phase.
  const dust = useMemo(() => {
    const positions = new Float32Array(DUST * 3);
    const baseX = new Float32Array(DUST);
    const baseZ = new Float32Array(DUST);
    const speed = new Float32Array(DUST);
    const phase = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      const bx = (Math.random() * 2 - 1) * 1.5;
      const bz = (Math.random() * 2 - 1) * 0.7;
      baseX[i] = bx;
      baseZ[i] = bz;
      positions[i * 3] = bx;
      positions[i * 3 + 1] = Math.random() * 2.4 - 1.6;
      positions[i * 3 + 2] = bz;
      speed[i] = 0.05 + Math.random() * 0.1;
      phase[i] = Math.random() * Math.PI * 2;
    }
    return { positions, baseX, baseZ, speed, phase };
  }, []);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const stage = stageRef.current;
    // Sharp window so the glow pops in/out with the materials stage.
    const w = Math.max(0, 1 - Math.abs(stage - STAGE.MATERIALS) * 2.4);
    g.visible = w > 0.01;
    if (glowMat.current) glowMat.current.opacity = w * 0.85;
    if (coreMat.current) coreMat.current.opacity = w * 0.6;
    if (dustMat.current) dustMat.current.opacity = w * 0.8;
    if (upRef.current) upRef.current.intensity = w * 6;
    if (!g.visible) return;

    // Drift the dust gently upward, swaying around its base x/z, wrapping
    // back to the bottom when it rises out of the glow.
    const t = state.clock.elapsedTime;
    const pts = pointsRef.current;
    if (pts && !reducedMotion) {
      const attr = pts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < DUST; i++) {
        let y = arr[i * 3 + 1] + dust.speed[i] * delta;
        if (y > 1.1) y = -1.6;
        arr[i * 3 + 1] = y;
        arr[i * 3] = dust.baseX[i] + Math.sin(t * 0.4 + dust.phase[i]) * 0.05;
        arr[i * 3 + 2] = dust.baseZ[i] + Math.cos(t * 0.3 + dust.phase[i]) * 0.05;
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Cool uplight so the floating hologram catches the glow. */}
      <pointLight ref={upRef} position={[0, -1.3, 0.6]} color="#9fc6ff" intensity={0} distance={4} />

      {/* Broad glow welling up from the bottom of the frame. */}
      <mesh position={[0, -0.7, -0.4]}>
        <planeGeometry args={[6, 3.4]} />
        <meshBasicMaterial
          ref={glowMat}
          map={glowTex}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Tighter, brighter core right at the bottom centre. */}
      <mesh position={[0, -1.0, -0.2]}>
        <planeGeometry args={[3, 2.2]} />
        <meshBasicMaterial
          ref={coreMat}
          map={glowTex}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Dust motes floating in the glow. */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={dustMat}
          map={dustTex}
          color={GLOW}
          size={0.05}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
