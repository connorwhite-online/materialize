"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";
import { STAGE, STICKER_YELLOW, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

// Classic dollar-store starburst point count (drawn into the sticker).
const STAR_POINTS = 12;
// How much the clear blister stands off the device front.
const WRAP_SCALE = 1.16;

/** The whole $1 starburst sticker drawn to one transparent texture —
 *  a clean, flat printed decal (burst + price in one). */
function makeStickerTexture(): THREE.CanvasTexture {
  const S = 320;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  const outer = S * 0.46;
  const inner = S * 0.34;
  ctx.beginPath();
  for (let i = 0; i < STAR_POINTS * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / STAR_POINTS - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = STICKER_YELLOW;
  ctx.fill();
  ctx.lineWidth = S * 0.018;
  ctx.strokeStyle = "#b8870c";
  ctx.stroke();
  ctx.fillStyle = "#1a1304";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${S * 0.42}px Arial, sans-serif`;
  ctx.fillText("$1", cx, cy + S * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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
/**
 * The "buy & sell" stage: the assembled device sealed in a retail pack.
 * The clear shield is a glossy front blister (the device's front cover,
 * stood off); the cardboard backing card carries an open peg slot; and
 * the $1 starburst is a flat printed sticker on the front. Fades with
 * proximity to the COMMERCE stage.
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const { front, size } = useDeviceGeometry();
  const groupRef = useRef<THREE.Group>(null);

  const stickerTex = useMemo(() => makeStickerTexture(), []);
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

      {/* Glossy clear blister over the front of the device (front cover
          only, stood off) — reads as a clean vacuum-formed shield. */}
      <group scale={WRAP_SCALE}>
        <mesh geometry={front}>
          <meshPhysicalMaterial
            color="#eef4f7"
            metalness={0}
            roughness={0.05}
            transmission={0.6}
            ior={1.45}
            thickness={0.02}
            clearcoat={1}
            clearcoatRoughness={0.04}
            transparent
            opacity={0}
            side={THREE.FrontSide}
          />
        </mesh>
      </group>

      {/* $1 starburst — one flat printed sticker decal on the front. */}
      <mesh position={[-cardW * 0.28, cardH * 0.24, frontZ + 0.04]} rotation={[0, 0, -0.12]}>
        <planeGeometry args={[0.42, 0.42]} />
        <meshBasicMaterial map={stickerTex} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}
