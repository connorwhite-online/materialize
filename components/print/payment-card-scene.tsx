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
 * How long the context must stay healthy before we promote to `live`.
 * SwiftShader (and flaky mobile GPUs) often paint one frame, we used
 * to call onReady, then lose the context — fee sheet flashed WebGL
 * then snapped to CSS. Hold the canvas at opacity-0 until this gate
 * passes; if it dies first, onFail and the user never saw WebGL.
 */
export const WEBGL_STABLE_MS = 500;

function isSoftwareRenderer(gl: THREE.WebGLRenderer): boolean {
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  if (!dbg) return false;
  const renderer = String(
    gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? ""
  );
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(
    renderer
  );
}

/**
 * Promote only after a healthy stretch — never on the first frame.
 */
function ReadySignal({
  onReady,
  onFail,
}: {
  onReady?: () => void;
  onFail?: () => void;
}) {
  const decided = useRef(false);
  const goodSince = useRef<number | null>(null);
  useFrame(({ gl }) => {
    if (decided.current) return;
    if (gl.getContext().isContextLost()) {
      decided.current = true;
      onFail?.();
      return;
    }
    const now = performance.now();
    if (goodSince.current == null) goodSince.current = now;
    if (now - goodSince.current >= WEBGL_STABLE_MS) {
      decided.current = true;
      onReady?.();
    }
  });
  return null;
}

/**
 * Thin metallic payment card — a plane with a whisper of thickness.
 *
 * Not the earlier chunky RoundedBox + bevelled extrusion (that read
 * as a bubbly brick). Body stays near real ID-1 thickness; the mark
 * is a flat decal (extrude depth scaled paper-thin, no bevel); chip
 * is a shallow plate. Rest pose mirrors the CSS face tilt so the
 * two don't feel like different products when WebGL fails over.
 */

const TITANIUM = {
  color: "#8a8a92",
  metalness: 0.95,
  roughness: 0.34,
} as const;

const CHIP_GOLD = {
  color: "#c9a227",
  metalness: 1,
  roughness: 0.28,
} as const;

const CHIP_PAD = {
  color: "#6e5610",
  metalness: 1,
  roughness: 0.45,
} as const;

/** CSS face uses rotateX(12deg) rotateY(-16deg) — match that rest. */
const REST_X = (12 * Math.PI) / 180;
const REST_Y = (-16 * Math.PI) / 180;

function makeLogoGeometry(): THREE.BufferGeometry {
  const loader = new SVGLoader();
  const data = loader.parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><path fill="#000" d="${MARK_PATH}"/></svg>`
  );
  const shapes = data.paths.flatMap((path) => SVGLoader.createShapes(path));
  // Flat decal — tiny depth, no bevel. The old pass used depth 14 +
  // bevel and scaled into a chunky extruded mark.
  const geom = new THREE.ExtrudeGeometry(shapes, {
    depth: 1,
    bevelEnabled: false,
  });
  geom.scale(1, -1, 1);
  geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  const s = LOGO_WIDTH / size.x;
  // Keep Z paper-thin after the XY normalize.
  geom.scale(s, s, s * 0.04);
  geom.center();
  geom.computeBoundingBox();
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
        roughness={0.22}
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
      <RoundedBox args={[0.24, 0.18, 0.006]} radius={0.012} smoothness={3}>
        <meshPhysicalMaterial
          color={CHIP_GOLD.color}
          metalness={CHIP_GOLD.metalness}
          roughness={CHIP_GOLD.roughness}
        />
      </RoundedBox>
      {pads.map(([x, y]) => (
        <mesh key={`${x}:${y}`} position={[x, y, 0.004]}>
          <boxGeometry args={[0.078, 0.024, 0.0015]} />
          <meshPhysicalMaterial
            color={CHIP_PAD.color}
            metalness={CHIP_PAD.metalness}
            roughness={CHIP_PAD.roughness}
          />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.004]}>
        <boxGeometry args={[0.036, 0.1, 0.0015]} />
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
            letterSpacing={0.02}
          >
            Service fee
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

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (paused) {
      g.rotation.x = REST_X;
      g.rotation.y = REST_Y;
      g.rotation.z = 0;
      return;
    }
    const t = state.clock.elapsedTime;
    // Gentle hover — keep the plate reading as a card, not a toy.
    const hoverX = REST_X - state.pointer.y * 0.1;
    const hoverY = REST_Y + state.pointer.x * 0.14;
    const idleX = Math.sin(t * 0.45) * 0.02;
    const idleY = Math.sin(t * 0.35) * 0.03;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, hoverX + idleX, 0.08);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, hoverY + idleY, 0.08);
    g.rotation.z = 0;
  });

  return (
    <group ref={group} rotation={[REST_X, REST_Y, 0]} position={[0, 0.02, 0]}>
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
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 5, 5]} intensity={1.25} />
      <directionalLight position={[-5, -3, -5]} intensity={0.45} />
      <directionalLight position={[0, -5, 2]} intensity={0.35} />
      <StudioEnvironment />
      <CardRig paused={paused}>
        <RoundedBox
          args={[CARD_W, CARD_H, CARD_T]}
          radius={CARD_RADIUS}
          smoothness={4}
          bevelSegments={1}
        >
          <meshPhysicalMaterial
            color={TITANIUM.color}
            metalness={TITANIUM.metalness}
            roughness={TITANIUM.roughness}
            clearcoat={0.12}
            clearcoatRoughness={0.45}
            envMapIntensity={1.2}
          />
        </RoundedBox>
        <LogoMark />
        <EmvChip />
        <CardFaceCopy amountCents={amountCents} brand={brand} last4={last4} />
      </CardRig>
      <ContactShadows
        position={[0, -0.58, 0]}
        opacity={0.22}
        scale={3}
        blur={2.6}
        far={1.2}
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
  onReady?: () => void;
  onFail?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const paused = Boolean(reducedMotion);
  return (
    <Canvas
      camera={{ position: [0, 0.08, 2.15], fov: 32 }}
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      frameloop={paused ? "demand" : "always"}
      onCreated={({ gl }) => {
        // Software GL will paint a frame then die (or look wrong).
        // Bail before ReadySignal can ever promote to `live`.
        if (isSoftwareRenderer(gl)) {
          onFail?.();
          return;
        }
        const el = gl.domElement;
        el.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            onFail?.();
          },
          false
        );
      }}
    >
      <ReadySignal onReady={onReady} onFail={onFail} />
      <Scene
        paused={paused}
        amountCents={amountCents}
        brand={brand}
        last4={last4}
      />
    </Canvas>
  );
}
