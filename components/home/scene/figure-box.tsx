"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { STAGE, STICKER_YELLOW, COMMERCE_YAW, COMMERCE_PITCH, stageWeight } from "./constants";

// Classic dollar-store starburst. The brief said "7-pronged"; the real
// retail look is a denser burst, so this is exposed as a dial.
const STAR_POINTS = 12;

// Carton dimensions (world units; device is ~1.5 wide).
const BOX_W = 2.2;
const BOX_H = 1.7;
const BOX_D = 0.9;
const WALL = 0.05;
const CARD_COLOR = "#d8cdb6";

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
 * Printed front panel of the carton: cardboard with a header band,
 * brand lockup, a die-cut window (transparent, so the product shows
 * through), and a footer barcode. Drawn to a canvas so it reads as
 * real grocery-store packaging.
 */
function makeFrontTexture(): THREE.CanvasTexture {
  const w = 560;
  const h = 433;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = CARD_COLOR;
  ctx.fillRect(0, 0, w, h);

  // Header band.
  ctx.fillStyle = "#18302b";
  ctx.fillRect(0, 0, w, 78);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f4ead6";
  ctx.font = "800 50px Arial, sans-serif";
  ctx.fillText("MATERIALIZE", w / 2, 34);
  ctx.font = "italic 24px Georgia, serif";
  ctx.fillStyle = STICKER_YELLOW;
  ctx.fillText("Anything", w / 2, 64);

  // Die-cut window — cleared to transparent so the device shows through.
  const wx = 56;
  const wy = 104;
  const ww = w - 112;
  const wh = 232;
  ctx.clearRect(wx, wy, ww, wh);
  // Printed window frame.
  ctx.strokeStyle = "#18302b";
  ctx.lineWidth = 6;
  ctx.strokeRect(wx - 4, wy - 4, ww + 8, wh + 8);

  // Footer copy + barcode.
  ctx.fillStyle = "#18302b";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText("PRINT-READY 3D FILE", w / 2, 364);
  let x = w / 2 - 70;
  for (let i = 0; i < 30; i++) {
    const bw = 1 + Math.round(Math.random() * 3);
    ctx.fillRect(x, 392, bw, 26);
    x += bw + 2 + Math.round(Math.random() * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The "buy & sell" stage: the lone device sits inside a collectible
 * retail carton — six printed cardboard panels with a die-cut window,
 * a cellophane sheet over the opening, and a dollar-store $1 star
 * sticker. Held at the shared COMMERCE angle so the side walls give it
 * real box depth and the device (rotated to match) reads as enclosed.
 * Everything fades with proximity to the COMMERCE stage.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const filmMat = useRef<THREE.MeshPhysicalMaterial>(null);

  const star = useMemo(() => makeStarShape(STAR_POINTS, 0.24, 0.13), []);
  const priceTex = useMemo(() => makePriceTexture(), []);
  const frontTex = useMemo(() => makeFrontTexture(), []);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = stageWeight(stageRef.current, STAGE.COMMERCE);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    const targetScale = 0.92 + w * 0.08;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, targetScale, k));
    g.visible = w > 0.01;

    // Fade every panel; the cellophane gets a glassy lower ceiling.
    g.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material & {
        opacity: number;
      };
      if (!mat || typeof mat.opacity !== "number") return;
      const ceiling = mat === filmMat.current ? 0.4 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, w * ceiling, k);
    });
  });

  const cardboard = (color = CARD_COLOR) => (
    <meshStandardMaterial color={color} roughness={0.92} metalness={0} transparent opacity={0} />
  );

  return (
    <group ref={groupRef} visible={false} rotation={[COMMERCE_PITCH, COMMERCE_YAW, 0]}>
      {/* Interior back wall — cardboard backdrop behind the product. */}
      <mesh position={[0, 0, -BOX_D / 2 + WALL / 2]}>
        <boxGeometry args={[BOX_W - WALL, BOX_H - WALL, WALL]} />
        {cardboard("#cfc4ac")}
      </mesh>
      {/* Four depth walls. */}
      <mesh position={[0, BOX_H / 2 - WALL / 2, 0]}>
        <boxGeometry args={[BOX_W, WALL, BOX_D]} />
        {cardboard()}
      </mesh>
      <mesh position={[0, -BOX_H / 2 + WALL / 2, 0]}>
        <boxGeometry args={[BOX_W, WALL, BOX_D]} />
        {cardboard()}
      </mesh>
      <mesh position={[-BOX_W / 2 + WALL / 2, 0, 0]}>
        <boxGeometry args={[WALL, BOX_H, BOX_D]} />
        {cardboard("#cdc2aa")}
      </mesh>
      <mesh position={[BOX_W / 2 - WALL / 2, 0, 0]}>
        <boxGeometry args={[WALL, BOX_H, BOX_D]} />
        {cardboard("#cdc2aa")}
      </mesh>

      {/* Printed front panel with the die-cut window. */}
      <mesh position={[0, 0, BOX_D / 2]}>
        <planeGeometry args={[BOX_W, BOX_H]} />
        <meshStandardMaterial
          map={frontTex}
          roughness={0.9}
          metalness={0}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Cellophane over the window opening. */}
      <mesh position={[0, -0.06, BOX_D / 2 - 0.01]}>
        <planeGeometry args={[BOX_W - 0.4, 0.92]} />
        <meshPhysicalMaterial
          ref={filmMat}
          color="#ffffff"
          metalness={0}
          roughness={0.04}
          transmission={0.95}
          ior={1.2}
          clearcoat={1}
          clearcoatRoughness={0.04}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* $1 starburst sticker on the front, top-left corner. */}
      <group position={[-0.74, 0.5, BOX_D / 2 + 0.02]} rotation={[0, 0, -0.12]}>
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
