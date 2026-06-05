"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";
import { STAGE, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

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

/** Cavity outline: a tight rounded rect around the device with a
 *  finger-pry scoop bulging out of each long side. */
function makeCavityPath(w: number, h: number, r: number, scoopR: number): THREE.Path {
  const hw = w / 2;
  const hh = h / 2;
  const p = new THREE.Path();
  p.moveTo(-hw + r, -hh);
  p.lineTo(hw - r, -hh);
  p.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  p.lineTo(hw, -scoopR);
  p.absarc(hw, 0, scoopR, -Math.PI / 2, Math.PI / 2, false); // right finger scoop
  p.lineTo(hw, hh - r);
  p.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  p.lineTo(-hw + r, hh);
  p.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-hw, scoopR);
  p.absarc(-hw, 0, scoopR, Math.PI / 2, Math.PI * 1.5, false); // left finger scoop
  p.lineTo(-hw, -hh + r);
  p.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

/** Pressed-recycled-fiber / pulp texture: warm base + dense flecks. */
function makePulpTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  x.fillStyle = "#cabf9c";
  x.fillRect(0, 0, S, S);
  const palette = ["#b8aa80", "#d6cba6", "#a89368", "#c2b489", "#8d7a50"];
  for (let i = 0; i < 6500; i++) {
    x.globalAlpha = 0.15 + Math.random() * 0.35;
    x.fillStyle = palette[(Math.random() * palette.length) | 0];
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, 0.4 + Math.random() * 1.9, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 340; i++) {
    x.globalAlpha = 1;
    x.fillStyle = `rgba(78,62,38,${0.2 + Math.random() * 0.3})`;
    const r = 0.6 + Math.random() * 1.7;
    x.beginPath();
    x.ellipse(Math.random() * S, Math.random() * S, r, r * (0.6 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * The packaging stage: the assembled device drops into a molded
 * recycled-pulp tray (a fiber-board pack with a device-shaped cavity).
 * The pack is angled so its opening faces toward the camera but off to
 * the left, like the reference. Fades with the COMMERCE stage; the
 * device falls into the cavity (see PrimaryDevice).
 */
export function FigureBox() {
  const { stageRef, reducedMotion } = useStage();
  const { size } = useDeviceGeometry();
  const groupRef = useRef<THREE.Group>(null);

  const pulpTex = useMemo(() => makePulpTexture(), []);

  // Shallower walls + a tighter cavity hugging the device.
  const trayDepth = size.z * 1.12;
  const cavW = size.x * 1.1;
  const cavH = size.y * 1.05;
  const scoopR = size.x * 0.09;
  const trayW = cavW + 0.42;
  const trayH = cavH + 0.42;

  // Tray rim/walls — an extruded frame (outer outline minus the cavity,
  // which has a finger-pry scoop on each long side).
  const trayGeo = useMemo(() => {
    const outer = new THREE.Shape();
    roundedRect(outer, 0, 0, trayW, trayH, 0.13);
    outer.holes.push(makeCavityPath(cavW, cavH, 0.08, scoopR));
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: trayDepth,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 3,
    });
    geo.translate(0, 0, -trayDepth / 2);
    return geo;
  }, [trayW, trayH, cavW, cavH, scoopR, trayDepth]);

  // Debossed relief grooves on the rim, for visual detail.
  const grooveY = trayH / 2 - 0.08;

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    // Sharper window + faster fade so the pack appears/disappears quickly
    // (it's gone well before the footer so the device can rise alone).
    const w = Math.max(0, 1 - Math.abs(stageRef.current - STAGE.COMMERCE) * 2.6);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 14);
    g.visible = w > 0.01;
    g.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      if (!mat || typeof mat.opacity !== "number") return;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, w, k);
    });
  });

  const pulp = (extra?: number) => (
    <meshStandardMaterial
      map={pulpTex}
      bumpMap={pulpTex}
      bumpScale={0.005}
      color={extra ? "#c0b693" : "#cabf9c"}
      roughness={0.96}
      metalness={0}
      transparent
      opacity={0}
    />
  );

  return (
    <group ref={groupRef} visible={false} rotation={[COMMERCE_PITCH, COMMERCE_YAW, 0]}>
      {/* Rim / walls of the molded tray. */}
      <mesh geometry={trayGeo}>{pulp()}</mesh>
      {/* Cavity floor (closes the bottom of the pocket). */}
      <RoundedBox
        args={[cavW + 0.04, cavH + 0.04, 0.05]}
        radius={0.03}
        smoothness={3}
        position={[0, 0, -trayDepth / 2 + 0.025]}
      >
        {pulp(1)}
      </RoundedBox>
      {/* Relief detail: debossed grooves on the top + bottom rim. */}
      {[grooveY, -grooveY].map((gy, row) =>
        [-1, 0, 1].map((i) => (
          <mesh key={`${row}-${i}`} position={[i * 0.12, gy, trayDepth / 2 - 0.012]}>
            <boxGeometry args={[0.07, 0.018, 0.03]} />
            <meshStandardMaterial color="#a89368" roughness={0.95} metalness={0} transparent opacity={0} />
          </mesh>
        ))
      )}
    </group>
  );
}
