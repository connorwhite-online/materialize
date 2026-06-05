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

  const trayDepth = size.z * 1.55;
  const cavW = size.x * 1.32;
  const cavH = size.y * 1.14;
  const trayW = cavW + 0.36;
  const trayH = cavH + 0.36;

  // Tray rim/walls — an extruded frame (outer outline minus the cavity).
  const trayGeo = useMemo(() => {
    const outer = new THREE.Shape();
    roundedRect(outer, 0, 0, trayW, trayH, 0.13);
    const hole = new THREE.Path();
    roundedRect(hole, 0, 0, cavW, cavH, 0.1);
    outer.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: trayDepth,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 3,
    });
    geo.translate(0, 0, -trayDepth / 2);
    return geo;
  }, [trayW, trayH, cavW, cavH, trayDepth]);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const w = Math.max(0, 1 - Math.abs(stageRef.current - STAGE.COMMERCE) * 1.7);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);
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
        args={[cavW + 0.06, cavH + 0.06, 0.06]}
        radius={0.04}
        smoothness={3}
        position={[0, 0, -trayDepth / 2 + 0.03]}
      >
        {pulp(1)}
      </RoundedBox>
    </group>
  );
}
