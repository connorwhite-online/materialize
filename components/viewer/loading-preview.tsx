"use client";

import { useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Loading placeholder — a wireframe icosahedron that springs between
 * near-polar rotations while a model loads. Distinctive, lightweight,
 * and feels like our brand shader.
 */
function SpinningShape() {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetRef = useRef({ x: 0, y: 0, z: 0 });
  const currentRef = useRef({ x: 0, y: 0, z: 0 });
  const velocityRef = useRef({ x: 0, y: 0, z: 0 });

  // Pick a new target orientation every 1.2s — randomly near polar axes
  useEffect(() => {
    const pickTarget = () => {
      // Snap rotations toward 90° increments for that "landing on an axis" feel
      const snap = (Math.PI / 2) * Math.round(Math.random() * 4 - 2);
      targetRef.current = {
        x: snap + (Math.random() - 0.5) * 0.4,
        y: (Math.PI / 2) * Math.round(Math.random() * 4 - 2) + (Math.random() - 0.5) * 0.4,
        z: (Math.random() - 0.5) * 0.6,
      };
    };

    pickTarget();
    const interval = setInterval(pickTarget, 1200);
    return () => clearInterval(interval);
  }, []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Spring physics toward target
    const stiffness = 60;
    const damping = 10;
    const cur = currentRef.current;
    const vel = velocityRef.current;
    const tgt = targetRef.current;

    for (const axis of ["x", "y", "z"] as const) {
      const k = axis as "x" | "y" | "z";
      const force = (tgt[k] - cur[k]) * stiffness;
      vel[k] += force * delta;
      vel[k] *= 1 - damping * delta;
      cur[k] += vel[k] * delta;
    }

    meshRef.current.rotation.set(cur.x, cur.y, cur.z);
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 2]} />
      <meshBasicMaterial
        color="#888"
        wireframe
        wireframeLinewidth={1}
      />
    </mesh>
  );
}

export function LoadingPreview({ text = "Loading preview..." }: { text?: string }) {
  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <SpinningShape />
      </Canvas>
      <div className="absolute inset-x-0 bottom-6 text-center pointer-events-none">
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
