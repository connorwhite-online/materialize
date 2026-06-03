"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { STAGE, STICKER_YELLOW, stageWeight } from "./constants";

// Classic dollar-store starburst. The brief said "7-pronged"; the real
// retail look is a denser burst, so this is exposed as a dial.
const STAR_POINTS = 12;

function makeStarShape(points: number, outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Draw the "$1" price text to a transparent canvas texture. */
function makePriceTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#1a1304";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 150px Arial, sans-serif";
  ctx.fillText("$1", size / 2, size / 2 + 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/**
 * The "buy & sell" stage: the lone device is sealed inside a
 * collectible action-figure box — a translucent enclosure wrapped in a
 * cellophane sheen with a dollar-store $1 star sticker pressed onto the
 * front. Everything scales/fades with proximity to the COMMERCE stage.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const boxMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const filmMat = useRef<THREE.MeshPhysicalMaterial>(null);

  const star = useMemo(() => makeStarShape(STAR_POINTS, 0.3, 0.16), []);
  const priceTex = useMemo(() => makePriceTexture(), []);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = stageWeight(stageRef.current, STAGE.COMMERCE);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    // Box materialises from slightly oversized + invisible.
    const targetScale = 0.92 + w * 0.08;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, targetScale, k));
    g.visible = w > 0.01;

    if (boxMat.current) {
      boxMat.current.opacity = THREE.MathUtils.lerp(boxMat.current.opacity, w * 0.55, k);
    }
    if (filmMat.current) {
      filmMat.current.opacity = THREE.MathUtils.lerp(filmMat.current.opacity, w * 0.35, k);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Outer carton — translucent so the figure reads through it. */}
      <RoundedBox args={[2.0, 1.45, 0.95]} radius={0.05} smoothness={4}>
        <meshPhysicalMaterial
          ref={boxMat}
          color="#dfe3e8"
          metalness={0}
          roughness={0.2}
          transmission={0.6}
          ior={1.2}
          thickness={0.3}
          transparent
          opacity={0}
        />
      </RoundedBox>

      {/* Cellophane window — a thin glossy film stretched over the front. */}
      <mesh position={[0, 0, 0.49]}>
        <planeGeometry args={[1.9, 1.35]} />
        <meshPhysicalMaterial
          ref={filmMat}
          color="#ffffff"
          metalness={0}
          roughness={0.02}
          transmission={0.95}
          clearcoat={1}
          clearcoatRoughness={0.04}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* $1 starburst sticker, pressed onto the cellophane, top-left. */}
      <group position={[-0.62, 0.42, 0.5]} rotation={[0, 0, -0.12]}>
        <mesh>
          <extrudeGeometry
            args={[star, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }]}
          />
          <meshStandardMaterial color={STICKER_YELLOW} metalness={0} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0, 0.033]}>
          <planeGeometry args={[0.34, 0.34]} />
          <meshBasicMaterial map={priceTex} transparent />
        </mesh>
      </group>
    </group>
  );
}
