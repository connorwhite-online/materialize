"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { STAGE, STICKER_YELLOW, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

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

/** Trace a centred rounded rectangle onto a Shape or Path. */
function roundedRect(
  ctx: THREE.Shape | THREE.Path,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number
) {
  const l = cx - w / 2;
  const rt = cx + w / 2;
  const t = cy + h / 2;
  const b = cy - h / 2;
  ctx.moveTo(l + r, b);
  ctx.lineTo(rt - r, b);
  ctx.absarc(rt - r, b + r, r, -Math.PI / 2, 0, false);
  ctx.lineTo(rt, t - r);
  ctx.absarc(rt - r, t - r, r, 0, Math.PI / 2, false);
  ctx.lineTo(l + r, t);
  ctx.absarc(l + r, t - r, r, Math.PI / 2, Math.PI, false);
  ctx.lineTo(l, b + r);
  ctx.absarc(l + r, b + r, r, Math.PI, Math.PI * 1.5, false);
}

/** "$1" price text on a transparent canvas texture. */
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
 * The "buy & sell" stage: the fully-assembled device sits in a simple
 * retail pack — a cardboard backing card with a die-cut hang-tag slot,
 * wrapped in a cellophane bubble, with a dollar-store $1 star sticker.
 * Held at the shared COMMERCE angle so it reads as a 3-D pack and the
 * device (rotated to match) sits enclosed. Fades with the COMMERCE
 * stage; uses a sharp weight so it's gone before the teardown explodes.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const filmMat = useRef<THREE.MeshPhysicalMaterial>(null);

  const star = useMemo(() => makeStarShape(STAR_POINTS, 0.24, 0.13), []);
  const priceTex = useMemo(() => makePriceTexture(), []);

  // Cardboard backing card with a hang-tag slot punched near the top.
  const cardGeo = useMemo(() => {
    const shape = new THREE.Shape();
    roundedRect(shape, 0, 0, 1.9, 2.0, 0.1);
    const slot = new THREE.Path();
    roundedRect(slot, 0, 0.84, 0.34, 0.1, 0.05);
    shape.holes.push(slot);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
    });
  }, []);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    // Sharp triangular weight — fully gone by ~stage 2.6, before the
    // teardown explode begins, so the boxed device is never exploded.
    const w = Math.max(0, 1 - Math.abs(stageRef.current - STAGE.COMMERCE) * 1.7);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, 0.94 + w * 0.06, k));
    g.visible = w > 0.01;

    g.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material & {
        opacity: number;
      };
      if (!mat || typeof mat.opacity !== "number") return;
      const ceiling = mat === filmMat.current ? 0.4 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, w * ceiling, k);
    });
  });

  return (
    <group ref={groupRef} visible={false} rotation={[COMMERCE_PITCH, COMMERCE_YAW, 0]}>
      {/* Cardboard backing card with the hang-tag cutout. */}
      <mesh geometry={cardGeo} position={[0, 0.05, -0.4]}>
        <meshStandardMaterial color="#d8cdb6" roughness={0.92} metalness={0} transparent opacity={0} />
      </mesh>

      {/* Cellophane bubble over the assembled device — the bulk of the pack. */}
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[1.72, 1.26, 0.6]} />
        <meshPhysicalMaterial
          ref={filmMat}
          color="#ffffff"
          metalness={0}
          roughness={0.04}
          transmission={0.96}
          ior={1.2}
          thickness={0.15}
          clearcoat={1}
          clearcoatRoughness={0.04}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* $1 starburst sticker on the cellophane, top-left. */}
      <group position={[-0.66, 0.42, 0.4]} rotation={[0, 0, -0.12]}>
        <mesh>
          <extrudeGeometry
            args={[star, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }]}
          />
          <meshStandardMaterial color={STICKER_YELLOW} metalness={0} roughness={0.55} transparent opacity={0} />
        </mesh>
        <mesh position={[0, 0, 0.033]}>
          <planeGeometry args={[0.28, 0.28]} />
          <meshBasicMaterial map={priceTex} transparent opacity={0} />
        </mesh>
      </group>
    </group>
  );
}
