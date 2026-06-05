"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";
import { STAGE, STICKER_YELLOW, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

// Classic dollar-store starburst. The brief said "7-pronged"; the real
// retail look is a denser burst, so this is exposed as a dial.
const STAR_POINTS = 12;
// How much the clear wrap stands off the device surface (vacuum-form fit).
const WRAP_SCALE = 1.05;

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

/**
 * Backing-card outline with an open peg slot: a narrow slit runs in
 * from the top edge down to a semicircle the peg rests in — a cleaner,
 * more futuristic take on the classic hang hole.
 */
function makeCardShape(cardW: number, cardH: number): THREE.Shape {
  const hw = cardW / 2;
  const hh = cardH / 2;
  const r = 0.1;
  const slitHalf = 0.02;
  const circR = 0.058;
  const circCY = hh - 0.22;
  const yInt = circCY + Math.sqrt(Math.max(0, circR * circR - slitHalf * slitHalf));

  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false); // → (hw-r, hh)
  // Top edge in to the slit, down its right wall to the circle.
  s.lineTo(slitHalf, hh);
  s.lineTo(slitHalf, yInt);
  // Sweep the circle the long way (through the bottom) to the slit's left wall.
  const aR = Math.atan2(yInt - circCY, slitHalf);
  const aL = Math.atan2(yInt - circCY, -slitHalf);
  const start = aR;
  const end = aL - Math.PI * 2;
  const segs = 28;
  for (let i = 1; i <= segs; i++) {
    const a = start + (i / segs) * (end - start);
    s.lineTo(circR * Math.cos(a), circCY + circR * Math.sin(a));
  }
  s.lineTo(-slitHalf, hh); // up the slit's left wall
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Pressed-recycled-paper / cork texture: warm base + dense flecks. */
function makeCorkTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  x.fillStyle = "#cbbf9d";
  x.fillRect(0, 0, S, S);
  const palette = ["#b9ab83", "#d6cba8", "#a8966c", "#c2b48c", "#8f7c54"];
  for (let i = 0; i < 6000; i++) {
    x.globalAlpha = 0.15 + Math.random() * 0.35;
    x.fillStyle = palette[(Math.random() * palette.length) | 0];
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, 0.4 + Math.random() * 1.8, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 320; i++) {
    x.globalAlpha = 1;
    x.fillStyle = `rgba(80,64,40,${0.2 + Math.random() * 0.3})`;
    const r = 0.6 + Math.random() * 1.6;
    x.beginPath();
    x.ellipse(Math.random() * S, Math.random() * S, r, r * (0.6 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
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
 * The "buy & sell" stage: the assembled device sealed in a retail pack.
 * The clear shield is a vacuum-formed wrap that follows the device's own
 * shape (its shell geometry, stood off slightly); the cardboard backing
 * card carries a standard euro hang hole (round hole + neck); and the $1
 * starburst is a flat, depth-less printed sticker on the front. Fades
 * with proximity to the COMMERCE stage.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const { front, back, size } = useDeviceGeometry();
  const groupRef = useRef<THREE.Group>(null);

  const star = useMemo(() => makeStarShape(STAR_POINTS, 0.24, 0.13), []);
  const starGeo = useMemo(() => new THREE.ShapeGeometry(star), [star]);
  const priceTex = useMemo(() => makePriceTexture(), []);
  const corkTex = useMemo(() => makeCorkTexture(), []);

  const cardW = size.x * 1.7;
  const cardH = size.y * 1.32;
  const frontZ = (size.z / 2) * WRAP_SCALE;

  // Backing card with an open peg slot (slit in from the top → semicircle rest).
  const cardGeo = useMemo(() => {
    const shape = makeCardShape(cardW, cardH);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 2,
    });
  }, [cardW, cardH]);

  const wrapMaterial = () => (
    <meshPhysicalMaterial
      color="#ffffff"
      metalness={0}
      roughness={0.06}
      transmission={0.94}
      ior={1.3}
      thickness={0.04}
      clearcoat={1}
      clearcoatRoughness={0.06}
      transparent
      opacity={0}
      side={THREE.DoubleSide}
    />
  );

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = Math.max(0, 1 - Math.abs(stageRef.current - STAGE.COMMERCE) * 1.7);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);
    g.visible = w > 0.01;
    g.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material & {
        opacity: number;
        transmission?: number;
      };
      if (!mat || typeof mat.opacity !== "number") return;
      // The clear wrap stays glassy; everything else fades fully in.
      const ceiling = (mat.transmission ?? 0) > 0.5 ? 0.45 : 1;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, w * ceiling, k);
    });
  });

  return (
    <group ref={groupRef} visible={false} rotation={[COMMERCE_PITCH, COMMERCE_YAW, 0]}>
      {/* Pressed-recycled-paper backing card with the open peg slot. */}
      <mesh geometry={cardGeo} position={[0, size.y * 0.12, -size.z * 0.9]}>
        <meshStandardMaterial
          map={corkTex}
          bumpMap={corkTex}
          bumpScale={0.004}
          color="#ffffff"
          roughness={0.95}
          metalness={0}
          transparent
          opacity={0}
        />
      </mesh>

      {/* Form-fitted vacuum wrap — the device's own shell, stood off. */}
      <group scale={WRAP_SCALE}>
        <mesh geometry={front}>{wrapMaterial()}</mesh>
        <mesh geometry={back}>{wrapMaterial()}</mesh>
      </group>

      {/* Flat $1 sticker — a depth-less printed decal on the front. */}
      <group position={[-cardW * 0.3, cardH * 0.22, frontZ + 0.03]} rotation={[0, 0, -0.12]}>
        <mesh geometry={starGeo}>
          <meshStandardMaterial color={STICKER_YELLOW} roughness={0.6} metalness={0} transparent opacity={0} />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[0.28, 0.28]} />
          <meshBasicMaterial map={priceTex} transparent opacity={0} />
        </mesh>
      </group>
    </group>
  );
}
