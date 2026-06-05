"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import {
  TEARDOWN_PARTS,
  type TeardownPart,
  ORDER_CENTER,
  EXPLODE_SPACING,
  PCB_ORDER,
} from "./constants";
import { useDeviceGeometry } from "./use-device-geometry";

export interface MaterialTarget {
  color: THREE.Color;
  metalness: number;
  roughness: number;
  clearcoat: number;
  transmission: number;
  ior: number;
  thickness: number;
}

interface DeviceModelProps {
  /** Shell material the hardbody lerps toward. */
  target: MaterialTarget;
  /** 0 = assembled, 1 = fully exploded teardown. */
  explodeRef: MutableRefObject<number>;
  /** Render the internal components (PCB, chips, battery, …). */
  showInternals?: boolean;
  /** Mount the leader-line teardown labels (primary device only). */
  showLabels?: boolean;
  castShadow?: boolean;
}

// --- internal component palette (fixed; only the shell takes `target`) ---
const PCB_COLOR = "#163a2b";
const CHIP_COLOR = "#0e1013";
const METAL_COLOR = "#b9bdc4";
const LENS_COLOR = "#05070a";

/** Internal component geometry, sized relative to the shell. */
function PartGeometry({ id, size }: { id: string; size: THREE.Vector3 }) {
  const w = size.x;
  switch (id) {
    case "soc":
      return (
        <RoundedBox args={[w * 0.22, w * 0.22, 0.045]} radius={0.01} smoothness={4}>
          <meshStandardMaterial color={CHIP_COLOR} metalness={0.4} roughness={0.5} />
        </RoundedBox>
      );
    case "mcu":
      return (
        <RoundedBox args={[w * 0.14, w * 0.14, 0.035]} radius={0.008} smoothness={4}>
          <meshStandardMaterial color={CHIP_COLOR} metalness={0.4} roughness={0.5} />
        </RoundedBox>
      );
    case "modem":
      return (
        <RoundedBox args={[w * 0.28, w * 0.2, 0.035]} radius={0.008} smoothness={4}>
          <meshStandardMaterial color="#1a1c1f" metalness={0.55} roughness={0.4} />
        </RoundedBox>
      );
    case "camera":
      return (
        <group>
          {/* Module looks up (+Y) to match the top-face camera hole. */}
          <mesh>
            <cylinderGeometry args={[w * 0.11, w * 0.11, 0.06, 40]} />
            <meshStandardMaterial color="#16181c" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 0.08, 40]} />
            <meshPhysicalMaterial color={LENS_COLOR} metalness={0.1} roughness={0.05} clearcoat={1} />
          </mesh>
        </group>
      );
    case "battery":
      return (
        <RoundedBox args={[w * 0.66, size.y * 0.5, size.z * 0.42]} radius={0.02} smoothness={5}>
          <meshStandardMaterial color={METAL_COLOR} metalness={0.55} roughness={0.45} />
        </RoundedBox>
      );
    case "speaker":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[w * 0.12, w * 0.12, 0.05, 40]} />
          <meshStandardMaterial color="#26282c" metalness={0.5} roughness={0.5} />
        </mesh>
      );
    default:
      return null;
  }
}

/** Female USB-C port: a recessed pill cavity with a tongue. Opening
 *  faces +Y (mapped onto the drafted bottom face by the parent group). */
function UsbCPort({ w }: { w: number }) {
  return (
    <group>
      <RoundedBox args={[w * 0.24, 0.04, w * 0.1]} radius={0.012} smoothness={4}>
        <meshStandardMaterial color="#3a3d42" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[w * 0.2, 0.05, w * 0.07]} radius={w * 0.035} smoothness={5} position={[0, -0.008, 0]}>
        <meshStandardMaterial color="#050608" roughness={0.9} metalness={0.1} />
      </RoundedBox>
      <RoundedBox args={[w * 0.15, 0.016, w * 0.03]} radius={0.006} smoothness={4} position={[0, -0.006, 0]}>
        <meshStandardMaterial color="#2a2c30" metalness={0.4} roughness={0.6} />
      </RoundedBox>
    </group>
  );
}

/** Inline GitHub mark — lucide-react v1 dropped brand icons. */
function GithubMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function TeardownLabel({ part, size }: { part: TeardownPart; size: THREE.Vector3 }) {
  const dir = part.labelSide === "right" ? 1 : -1;
  const end: [number, number, number] = [dir * 0.5, part.labelY * size.y, 0.12];
  return (
    <group>
      <Line points={[[0, 0, 0], end]} color="#8a8f98" lineWidth={1} transparent opacity={0.7} />
      <mesh position={end}>
        <sphereGeometry args={[0.016, 12, 12]} />
        <meshBasicMaterial color="#8a8f98" />
      </mesh>
      <Html position={end} distanceFactor={3.4} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
        <div
          className="teardown-label-fade flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-background/85 px-1.5 py-0.5 text-[10px] font-medium tracking-tight text-foreground shadow-sm backdrop-blur"
          style={{
            transform: dir > 0 ? "translateX(0.3rem)" : "translateX(-100%) translateX(-0.3rem)",
          }}
        >
          {part.github && <GithubMark />}
          {part.label}
        </div>
      </Html>
    </group>
  );
}

/**
 * The Pneuma device, built on the real two-body hardbody (glTF). The
 * front/back covers part along the assembly access line (thickness) in
 * the teardown while the BOM components — battery, speaker, modem, wake
 * MCU, Linux SoC, camera — slide out along the same axis by layer
 * order. Small parts (LED, mic, USB-C) sit on the front cover behind
 * the real holes so they read through them.
 */
export function DeviceModel({
  target,
  explodeRef,
  showInternals = true,
  showLabels = false,
  castShadow = true,
}: DeviceModelProps) {
  const { front, back, size, topCap, bottomCap } = useDeviceGeometry();
  const frontRef = useRef<THREE.Group>(null);
  const backRef = useRef<THREE.Group>(null);
  const internalsRef = useRef<THREE.Group>(null);
  const frontMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const backMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const partRefs = useRef<Record<string, THREE.Group | null>>({});

  const w = size.x;
  const h = size.y;

  // Quaternions that lay the seated components flat onto the drafted
  // end faces (their local +Y aligns with each face's measured normal).
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const topQ = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, topCap.normal),
    [UP, topCap]
  );
  const bottomQ = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, bottomCap.normal),
    [UP, bottomCap]
  );

  const lerpShell = (mat: THREE.MeshPhysicalMaterial | null, dt: number) => {
    if (!mat) return;
    const k = 1 - Math.exp(-dt * 4);
    mat.color.lerp(target.color, k);
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, target.metalness, k);
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, target.roughness, k);
    mat.clearcoat = THREE.MathUtils.lerp(mat.clearcoat, target.clearcoat, k);
    mat.transmission = THREE.MathUtils.lerp(mat.transmission, target.transmission, k);
    mat.ior = THREE.MathUtils.lerp(mat.ior, target.ior, k);
    mat.thickness = THREE.MathUtils.lerp(mat.thickness, target.thickness, k);
    // Only genuinely transmissive materials (resin) are transparent —
    // otherwise the shell stays a solid opaque body that hides the
    // internals until the teardown opens it. A glassy Steel shell let
    // the guts show through, reading as "everything's on the outside".
    const wantTransparent = mat.transmission > 0.02;
    if (mat.transparent !== wantTransparent) {
      mat.transparent = wantTransparent;
      mat.needsUpdate = true;
    }
  };

  useFrame((_, delta) => {
    const e = explodeRef.current;
    lerpShell(frontMat.current, delta);
    lerpShell(backMat.current, delta);

    // Covers part along the thickness (Z); front toward the camera.
    if (frontRef.current) frontRef.current.position.z = e * 0.5;
    if (backRef.current) backRef.current.position.z = -e * 0.35;

    // Internals only appear once the case starts opening.
    if (internalsRef.current) internalsRef.current.visible = e > 0.015;

    for (const part of TEARDOWN_PARTS) {
      const g = partRefs.current[part.id];
      if (!g) continue;
      g.position.set(
        part.rest[0] * size.x,
        part.rest[1] * size.y,
        part.rest[2] * size.z + (part.order - ORDER_CENTER) * EXPLODE_SPACING * e
      );
    }
    const pcb = partRefs.current["pcb"];
    if (pcb) pcb.position.z = (PCB_ORDER - ORDER_CENTER) * EXPLODE_SPACING * e;
  });

  const shellMaterial = (ref: MutableRefObject<THREE.MeshPhysicalMaterial | null>) => (
    <meshPhysicalMaterial
      ref={ref}
      color={target.color}
      metalness={target.metalness}
      roughness={target.roughness}
      clearcoat={target.clearcoat}
      clearcoatRoughness={0.15}
      transmission={target.transmission}
      ior={target.ior}
      thickness={target.thickness}
      transparent={target.transmission > 0.02}
    />
  );

  return (
    <group>
      {/* --- Front cover (faces camera; carries the hole-aligned bits) --- */}
      <group ref={frontRef}>
        <mesh geometry={front} castShadow={castShadow} receiveShadow>
          {shellMaterial(frontMat)}
        </mesh>

        {/* Components seated in the real end-face holes, laid flat onto
            the 10° drafted faces (local +Y = the measured face normal).
            Top: camera + LED + mic; bottom: female USB-C. */}
        {showInternals && (
          <>
            <group position={topCap.point.toArray()} quaternion={topQ}>
              {/* Camera (10mm hole), centered. */}
              <mesh position={[0, -0.012, 0]}>
                <cylinderGeometry args={[w * 0.11, w * 0.11, 0.04, 40]} />
                <meshStandardMaterial color="#16181c" metalness={0.6} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[w * 0.085, 40]} />
                <meshPhysicalMaterial color={LENS_COLOR} metalness={0.1} roughness={0.05} clearcoat={1} />
              </mesh>
              {/* Status LED (2mm hole). */}
              <mesh position={[w * 0.24, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[w * 0.025, 24]} />
                <meshStandardMaterial color="#7dd3a0" emissive="#3fae6e" emissiveIntensity={1.6} />
              </mesh>
              {/* Mic (2×8mm slot). */}
              <mesh position={[-w * 0.24, 0.002, 0]}>
                <boxGeometry args={[w * 0.16, 0.012, w * 0.05]} />
                <meshStandardMaterial color="#202226" metalness={0.3} roughness={0.7} />
              </mesh>
            </group>

            <group position={bottomCap.point.toArray()} quaternion={bottomQ}>
              <UsbCPort w={w} />
            </group>
          </>
        )}
      </group>

      {/* --- Back cover --- */}
      <group ref={backRef}>
        <mesh geometry={back} castShadow={castShadow} receiveShadow>
          {shellMaterial(backMat)}
        </mesh>
      </group>

      {/* --- Internals — only shown once the teardown opens the shell;
          in the hero / box stages the device reads as a clean solid. --- */}
      {showInternals && (
        <group ref={internalsRef} visible={false}>
          <group
            ref={(el) => {
              partRefs.current["pcb"] = el;
            }}
            position={[0, h * 0.04, 0]}
          >
            <RoundedBox args={[w * 0.74, h * 0.82, 0.018]} radius={0.015} smoothness={5}>
              <meshStandardMaterial color={PCB_COLOR} metalness={0.2} roughness={0.65} />
            </RoundedBox>
          </group>

          {TEARDOWN_PARTS.map((part) => (
            <group
              key={part.id}
              ref={(el) => {
                partRefs.current[part.id] = el;
              }}
            >
              <PartGeometry id={part.id} size={size} />
              {showLabels && <TeardownLabel part={part} size={size} />}
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
