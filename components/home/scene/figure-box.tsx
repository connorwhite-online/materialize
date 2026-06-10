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

  // Much shallower walls + a tight cavity hugging the device.
  const trayDepth = size.z * 0.52;
  const cavW = size.x * 1.06;
  const cavH = size.y * 1.02;
  const scoopR = size.x * 0.1;
  const trayW = cavW + 0.46;
  const trayH = cavH + 0.46;

  // Tray rim/walls — an extruded frame (outer outline minus the cavity,
  // which has a finger-pry scoop on each long side).
  const trayGeo = useMemo(() => {
    const outer = new THREE.Shape();
    roundedRect(outer, 0, 0, trayW, trayH, 0.13);
    outer.holes.push(makeCavityPath(cavW, cavH, 0.08, scoopR));
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: trayDepth,
      bevelEnabled: true,
      bevelThickness: 0.022,
      bevelSize: 0.022,
      bevelSegments: 3,
    });
    geo.translate(0, 0, -trayDepth / 2);
    return geo;
  }, [trayW, trayH, cavW, cavH, scoopR, trayDepth]);

  // Raised inner lip — a thin tier sitting proud of the rim, inset from
  // the outer edge, so the rim reads as a molded two-step ledge.
  const lipGeo = useMemo(() => {
    const outer = new THREE.Shape();
    roundedRect(outer, 0, 0, trayW - 0.1, trayH - 0.1, 0.1);
    outer.holes.push(makeCavityPath(cavW + 0.05, cavH + 0.05, 0.09, scoopR));
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: 0.035,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
    });
    return geo;
  }, [trayW, trayH, cavW, cavH, scoopR]);

  // Floor z (just inside the cavity bottom) for ribs + bosses to sit on.
  const floorZ = -trayDepth / 2 + 0.05;
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
      {/* Raised inner lip — the second tier of the molded rim. */}
      <mesh geometry={lipGeo} position={[0, 0, trayDepth / 2 - 0.01]}>{pulp()}</mesh>
      {/* Cavity floor (closes the bottom of the pocket). */}
      <RoundedBox
        args={[cavW + 0.04, cavH + 0.04, 0.05]}
        radius={0.03}
        smoothness={3}
        position={[0, 0, -trayDepth / 2 + 0.025]}
      >
        {pulp(1)}
      </RoundedBox>
      {/* Molded support ribs across the cavity floor (the device rests on
          these, not the floor — characteristic of pressed-pulp packs). */}
      {[-0.34, -0.12, 0.12, 0.34].map((fy) => (
        <mesh key={`rib-${fy}`} position={[0, fy * cavH, floorZ]}>
          <boxGeometry args={[cavW * 0.8, cavH * 0.045, 0.055]} />
          {pulp(1)}
        </mesh>
      ))}
      {/* Chamfered corner support bosses on the floor. */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy]) => (
        <mesh
          key={`boss-${sx}-${sy}`}
          position={[sx * cavW * 0.4, sy * cavH * 0.42, floorZ]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.035, 0.06, 0.06, 18]} />
          {pulp(1)}
        </mesh>
      ))}
      {/* Debossed brand plate + relief grooves on the bottom rim. */}
      <mesh position={[0, -grooveY + 0.02, trayDepth / 2 - 0.006]}>
        <boxGeometry args={[0.5, 0.1, 0.014]} />
        <meshStandardMaterial color="#bcae88" roughness={0.94} metalness={0} transparent opacity={0} />
      </mesh>
      {[grooveY, -grooveY].map((gy, row) =>
        [-1.5, -0.5, 0.5, 1.5].map((i) => (
          <mesh key={`${row}-${i}`} position={[i * 0.1, gy, trayDepth / 2 - 0.012]}>
            <boxGeometry args={[0.06, 0.016, 0.03]} />
            <meshStandardMaterial color="#a89368" roughness={0.95} metalness={0} transparent opacity={0} />
          </mesh>
        ))
      )}
    </group>
  );
}
