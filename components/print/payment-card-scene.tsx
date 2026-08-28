"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox, Text } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
import { MARK_PATH, MARK_VIEWBOX } from "@/components/brand/logo-paths";
import {
  cardBrandLabel,
  formatUsdCents,
  type PaymentCardProps,
} from "./payment-card-fallback";
import {
  CARD_H,
  CARD_RADIUS,
  CARD_T,
  CARD_W,
  CHIP_POSITION,
  FACE_LIFT,
  LOGO_POSITION,
  LOGO_WIDTH,
} from "./payment-card-layout";

/**
 * Studio-lit 3D Materialize payment card.
 *
 * Same lighting stack as the dropzone primitives (physical metal +
 * in-memory IBL) so the card reads as a titanium object, not a CSS
 * illustration. Body is clean catalog titanium — metalness 1, light
 * clearcoat, no brush maps. Logo is the real mark path, extruded.
 * Chip is a gold contact plate on the RIGHT.
 *
 * ISO ID-1 proportion (85.60 × 53.98). Thickness is exaggerated so
 * the volume reads at the sheet's small canvas size.
 */

/** Titanium Ti6Al4V catalog row — the card body. */
const TITANIUM = {
  color: "#6e6e72",
  metalness: 1,
  roughness: 0.28,
} as const;

const CHIP_GOLD = {
  color: "#c9a227",
  metalness: 1,
  roughness: 0.22,
  clearcoat: 0.4,
  clearcoatRoughness: 0.25,
} as const;

const CHIP_PAD = {
  color: "#6e5610",
  metalness: 1,
  roughness: 0.4,
} as const;

function makeLogoGeometry(): THREE.ExtrudeGeometry {
  const loader = new SVGLoader();
  const data = loader.parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><path fill="#000" d="${MARK_PATH}"/></svg>`
  );
  const shapes = data.paths.flatMap((path) => SVGLoader.createShapes(path));
  const geom = new THREE.ExtrudeGeometry(shapes, {
    depth: 14,
    bevelEnabled: true,
    bevelThickness: 1.2,
    bevelSize: 0.8,
    bevelSegments: 2,
  });
  // SVG Y grows down; Three's Y grows up.
  geom.scale(1, -1, 1);
  geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  const s = LOGO_WIDTH / size.x;
  geom.scale(s, s, s * 0.28);
  geom.center();
  geom.computeBoundingBox();
  // Sit the back of the extrusion at local z = 0. LOGO_POSITION.z
  // then lifts the whole mesh FACE_LIFT above the card face so the
  // mark never shares a depth with the body (z-fighting shimmer).
  geom.translate(0, 0, -geom.boundingBox!.min.z);
  return geom;
}

function LogoMark() {
  const geometry = useMemo(() => makeLogoGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={LOGO_POSITION} renderOrder={1}>
      <meshPhysicalMaterial
        color="#f5f5f7"
        metalness={1}
        roughness={0.18}
        clearcoat={0.6}
        clearcoatRoughness={0.15}
        // Belt-and-suspenders with FACE_LIFT — pulls the mark forward
        // in the depth buffer if a bevel still grazes the face.
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

function EmvChip() {
  const pads: Array<[number, number]> = [
    [-0.055, 0.042],
    [-0.055, 0],
    [-0.055, -0.042],
    [0.055, 0.042],
    [0.055, 0],
    [0.055, -0.042],
  ];
  return (
    <group position={CHIP_POSITION}>
      <RoundedBox args={[0.24, 0.18, 0.014]} radius={0.02} smoothness={4}>
        <meshPhysicalMaterial
          color={CHIP_GOLD.color}
          metalness={CHIP_GOLD.metalness}
          roughness={CHIP_GOLD.roughness}
          clearcoat={CHIP_GOLD.clearcoat}
          clearcoatRoughness={CHIP_GOLD.clearcoatRoughness}
        />
      </RoundedBox>
      {pads.map(([x, y]) => (
        <mesh key={`${x}:${y}`} position={[x, y, 0.008]}>
          <boxGeometry args={[0.078, 0.024, 0.002]} />
          <meshPhysicalMaterial
            color={CHIP_PAD.color}
            metalness={CHIP_PAD.metalness}
            roughness={CHIP_PAD.roughness}
          />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.008]}>
        <boxGeometry args={[0.036, 0.1, 0.002]} />
        <meshPhysicalMaterial
          color={CHIP_PAD.color}
          metalness={CHIP_PAD.metalness}
          roughness={CHIP_PAD.roughness}
        />
      </mesh>
    </group>
  );
}

function CardFaceCopy({
  amountCents,
  brand,
  last4,
}: PaymentCardProps) {
  const amount = amountCents != null ? formatUsdCents(amountCents) : null;
  const pan = last4
    ? `${cardBrandLabel(brand) ? `${cardBrandLabel(brand)}  ` : ""}•••• ${last4}`
    : cardBrandLabel(brand) ?? "";
  // Same lift as the mark — Text coplanar with the body shimmered
  // under idle tilt the same way the extruded logo did.
  const faceZ = CARD_T / 2 + FACE_LIFT;

  return (
    <>
      {amount ? (
        <>
          <Text
            position={[-0.64, -0.02, faceZ]}
            fontSize={0.055}
            color="#d4d4d8"
            anchorX="left"
            anchorY="middle"
            letterSpacing={0.12}
          >
            SERVICE FEE
          </Text>
          <Text
            position={[-0.64, -0.16, faceZ]}
            fontSize={0.13}
            color="#f5f5f7"
            anchorX="left"
            anchorY="middle"
          >
            {amount}
          </Text>
        </>
      ) : null}
      {pan ? (
        <Text
          position={[-0.64, -0.38, faceZ]}
          fontSize={0.048}
          color="#e4e4e7"
          anchorX="left"
          anchorY="middle"
          letterSpacing={0.04}
        >
          {pan}
        </Text>
      ) : null}
    </>
  );
}

function CardRig({
  paused,
  children,
}: {
  paused: boolean;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const restX = 0.28;
  const restY = -0.42;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = restX;
      g.rotation.y = restY;
      g.rotation.z = 0.02;
      return;
    }
    const t = state.clock.elapsedTime;
    const hoverX = restX - state.pointer.y * 0.18;
    const hoverY = restY + state.pointer.x * 0.28;
    const idleX = Math.sin(t * 0.55) * 0.04;
    const idleY = Math.sin(t * 0.4) * 0.06;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = 0.02;
  });

  return (
    <group ref={group} rotation={[restX, restY, 0.02]} position={[0, 0.04, 0]}>
      {children}
    </group>
  );
}

function Scene({
  paused,
  amountCents,
  brand,
  last4,
}: PaymentCardProps & { paused: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (paused) invalidate();
  }, [paused, invalidate]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <directionalLight position={[-5, -3, -5]} intensity={0.5} />
      <directionalLight position={[0, -5, 2]} intensity={0.3} />
      <StudioEnvironment />
      <CardRig paused={paused}>
        <RoundedBox
          args={[CARD_W, CARD_H, CARD_T]}
          radius={CARD_RADIUS}
          smoothness={6}
          bevelSegments={4}
        >
          <meshPhysicalMaterial
            color={TITANIUM.color}
            metalness={TITANIUM.metalness}
            roughness={TITANIUM.roughness}
            clearcoat={0.35}
            clearcoatRoughness={0.28}
            envMapIntensity={1.15}
          />
        </RoundedBox>
        <LogoMark />
        <EmvChip />
        <CardFaceCopy amountCents={amountCents} brand={brand} last4={last4} />
      </CardRig>
      <ContactShadows
        position={[0, -0.62, 0]}
        opacity={0.32}
        scale={3.2}
        blur={2.4}
        far={1.4}
      />
    </>
  );
}

export function PaymentCardScene({
  amountCents,
  brand,
  last4,
  onReady,
  onFail,
}: PaymentCardProps & {
  /** Canvas has a live, non-lost WebGL context and painted a frame. */
  onReady?: () => void;
  /** Context lost / failed — parent should show the CSS fallback. */
  onFail?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const paused = Boolean(reducedMotion);
  return (
    <Canvas
      camera={{ position: [0, 0.1, 2.2], fov: 32 }}
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      frameloop={paused ? "demand" : "always"}
      onCreated={({ gl }) => {
        const el = gl.domElement;
        el.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            onFail?.();
          },
          false
        );
        // Defer past a synchronous context-lost so SwiftShader /
        // headless GPUs don't flash the canvas over the fallback.
        requestAnimationFrame(() => {
          if (gl.getContext().isContextLost()) {
            onFail?.();
            return;
          }
          onReady?.();
        });
      }}
    >
      <Scene
        paused={paused}
        amountCents={amountCents}
        brand={brand}
        last4={last4}
      />
    </Canvas>
  );
}
