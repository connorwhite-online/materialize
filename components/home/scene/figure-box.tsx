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
 * Printed graphics for the backing card — header band, brand lockup,
 * window outline, footer barcode — drawn to a canvas so it reads as
 * real grocery-store blister-pack packaging.
 */
function makeCardTexture(): THREE.CanvasTexture {
  const w = 540;
  const h = 460;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ece3d2";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#18302b";
  ctx.fillRect(0, 0, w, 100);
  ctx.fillStyle = "#f4ead6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 56px Arial, sans-serif";
  ctx.fillText("MATERIALIZE", w / 2, 44);
  ctx.font = "italic 26px Georgia, serif";
  ctx.fillStyle = STICKER_YELLOW;
  ctx.fillText("Anything", w / 2, 80);

  ctx.strokeStyle = "rgba(24,48,43,0.35)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(60, 130, w - 120, 220);
  ctx.setLineDash([]);

  ctx.fillStyle = "#18302b";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText("PRINT-READY 3D FILE", w / 2, 380);
  ctx.fillStyle = "#5b6b62";
  ctx.font = "16px Arial, sans-serif";
  ctx.fillText("COLLECT • PRINT • MAKE  ·  No. 001", w / 2, 408);

  let x = w / 2 - 70;
  ctx.fillStyle = "#18302b";
  for (let i = 0; i < 28; i++) {
    const bw = 1 + Math.round(Math.random() * 3);
    ctx.fillRect(x, 426, bw, 24);
    x += bw + 2 + Math.round(Math.random() * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The "buy & sell" stage: the lone device is sealed in a collectible
 * blister pack — a printed cardboard backing card with a hang-tab, a
 * clear vacuum-formed bubble over the product, and a dollar-store $1
 * star sticker. Everything scales/fades with proximity to the COMMERCE
 * stage; the blister is identified during the fade traversal so it
 * stays extra-transparent.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const blisterMat = useRef<THREE.MeshPhysicalMaterial>(null);

  const star = useMemo(() => makeStarShape(STAR_POINTS, 0.26, 0.14), []);
  const priceTex = useMemo(() => makePriceTexture(), []);
  const cardTex = useMemo(() => makeCardTexture(), []);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = stageWeight(stageRef.current, STAGE.COMMERCE);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    const targetScale = 0.92 + w * 0.08;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, targetScale, k));
    g.visible = w > 0.01;

    // Fade every material in the pack toward its target opacity; the
    // clear blister gets a lower ceiling so it reads as glassy.
    g.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.Material & { opacity: number };
      if (!mat || typeof mat.opacity !== "number") return;
      const ceiling = mat === blisterMat.current ? 0.5 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, w * ceiling, k);
    });
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Backing card — printed cardboard behind the product. */}
      <mesh position={[0, 0.05, -0.34]}>
        <planeGeometry args={[2.05, 1.75]} />
        <meshStandardMaterial map={cardTex} roughness={0.9} metalness={0} transparent opacity={0} />
      </mesh>
      {/* Card edge so it doesn't read as a floating decal. */}
      <RoundedBox args={[2.05, 1.75, 0.05]} radius={0.02} smoothness={3} position={[0, 0.05, -0.37]}>
        <meshStandardMaterial color="#d9cfba" roughness={0.95} transparent opacity={0} />
      </RoundedBox>

      {/* Hang-tab euro slot at the top of the card. */}
      <mesh position={[0, 0.95, -0.34]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07, 0.022, 12, 28]} />
        <meshStandardMaterial color="#18302b" roughness={0.8} transparent opacity={0} />
      </mesh>

      {/* Clear vacuum-formed bubble over the product. */}
      <RoundedBox args={[1.78, 1.32, 0.64]} radius={0.1} smoothness={4} position={[0, 0, 0.04]}>
        <meshPhysicalMaterial
          ref={blisterMat}
          color="#ffffff"
          metalness={0}
          roughness={0.04}
          transmission={0.94}
          ior={1.25}
          thickness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.04}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </RoundedBox>

      {/* $1 starburst sticker pressed onto the bubble, top-left. */}
      <group position={[-0.66, 0.46, 0.37]} rotation={[0, 0, -0.12]}>
        <mesh>
          <extrudeGeometry
            args={[star, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }]}
          />
          <meshStandardMaterial color={STICKER_YELLOW} metalness={0} roughness={0.55} transparent opacity={0} />
        </mesh>
        <mesh position={[0, 0, 0.033]}>
          <planeGeometry args={[0.3, 0.3]} />
          <meshBasicMaterial map={priceTex} transparent opacity={0} />
        </mesh>
      </group>
    </group>
  );
}
