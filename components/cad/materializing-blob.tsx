"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A wireframe icosahedron whose mesh slowly deforms via a noise displacement —
 * an idle/working visual for the text-to-CAD studio that reads as "something is
 * materializing out of a shapeless cloud." Pure GPU vertex displacement so it's
 * cheap to leave running. Shown in the empty state and during generation, with
 * the loading/progress feedback rendered beneath it.
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying float vD;

  // Cheap, smooth pseudo-noise from layered sines — no texture, GPU-friendly.
  float n(vec3 p) {
    return sin(p.x * 2.0 + uTime)
         * sin(p.y * 2.0 + uTime * 1.2)
         * sin(p.z * 2.0 + uTime * 0.8);
  }

  void main() {
    float d = n(position * 1.4 + uTime * 0.15);
    vD = d;
    vec3 displaced = position + normal * d * uAmp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vD;

  void main() {
    float a = clamp(0.5 + 0.3 * vD, 0.18, 0.85);
    gl_FragColor = vec4(uColor, a);
  }
`;

function Blob({ active }: { active: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  // Eased deform speed/amplitude so it accelerates when generation starts.
  const speed = useRef(0.6);
  const amp = useRef(0.16);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.16 },
      uColor: { value: new THREE.Color("#8aa0e8") },
    }),
    []
  );

  useFrame((_, delta) => {
    // Ease toward the target deform speed/amp — gentle when idle, faster and
    // more turbulent while a shape is generating ("working harder").
    const k = Math.min(1, delta * 2.5);
    speed.current += ((active ? 1.7 : 0.6) - speed.current) * k;
    amp.current += ((active ? 0.24 : 0.16) - amp.current) * k;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value += delta * speed.current;
      matRef.current.uniforms.uAmp.value = amp.current;
    }
    if (meshRef.current) {
      const rot = active ? 0.12 : 0.07;
      meshRef.current.rotation.y += delta * rot;
      meshRef.current.rotation.x += delta * rot * 0.3;
    }
  });

  return (
    <mesh ref={meshRef}>
      {/* detail 7 → very fine triangulation; rounder + denser wireframe.
          (This is about the practical ceiling — detail 8 quadruples again.) */}
      <icosahedronGeometry args={[1.3, 7]} />
      <shaderMaterial
        ref={matRef}
        wireframe
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
      />
    </mesh>
  );
}

export function MaterializingBlob({
  className,
  active = false,
}: {
  className?: string;
  /** Speed up + churn harder while a shape is generating. */
  active?: boolean;
}) {
  return (
    <div className={className}>
      {/* Camera pulled back so the blob reads as a small "entity" with room
          around it, not a sphere filling the frame. */}
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 2]}>
        <Blob active={active} />
      </Canvas>
    </div>
  );
}
