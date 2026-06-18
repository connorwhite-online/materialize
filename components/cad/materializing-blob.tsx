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

function Blob() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.16 },
      uColor: { value: new THREE.Color("#8aa0e8") },
    }),
    []
  );

  useFrame((_, delta) => {
    // Slow the deform: uTime drives the noise, so a smaller increment = gentler
    // morphing without affecting the rotation below.
    if (matRef.current) matRef.current.uniforms.uTime.value += delta * 0.4;
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.07;
      meshRef.current.rotation.x += delta * 0.02;
    }
  });

  return (
    <mesh ref={meshRef}>
      {/* detail 6 → fine triangulation for a dense wireframe. */}
      <icosahedronGeometry args={[1.3, 6]} />
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

export function MaterializingBlob({ className }: { className?: string }) {
  return (
    <div className={className}>
      {/* Camera pulled back so the blob reads as a small "entity" with room
          around it, not a sphere filling the frame. */}
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 2]}>
        <Blob />
      </Canvas>
    </div>
  );
}
