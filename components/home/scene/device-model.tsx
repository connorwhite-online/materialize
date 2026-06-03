"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html, Line } from "@react-three/drei";
import { RoundedBoxGeometry } from "three-stdlib";
import * as THREE from "three";
import { TEARDOWN_PARTS, type TeardownPart } from "./constants";

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
  /** Shell material the soft enclosure lerps toward. */
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

/**
 * A rounded box whose +Z half is drafted inward — a soft hump with a
 * tapered top face, per the device brief. three's RoundedBoxGeometry
 * already rounds every edge; we just inset the upper vertices to add
 * the draft angle.
 */
function useDraftedHump(
  w: number,
  h: number,
  d: number,
  radius: number,
  taperDeg: number
) {
  return useMemo(() => {
    const geo = new RoundedBoxGeometry(w, h, d, 6, radius);
    const pos = geo.attributes.position;
    const tan = Math.tan((taperDeg * Math.PI) / 180);
    const v = new THREE.Vector3();
    const halfTop = d / 2;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.z > 0) {
        const inset = (v.z / halfTop) * (halfTop * tan) * 2.4;
        v.x -= Math.sign(v.x) * Math.min(Math.abs(v.x), inset);
        v.y -= Math.sign(v.y) * Math.min(Math.abs(v.y), inset);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [w, h, d, radius, taperDeg]);
}

function PartGeometry({ id }: { id: string }) {
  switch (id) {
    case "soc":
      return (
        <>
          <RoundedBox args={[0.28, 0.28, 0.08]} radius={0.015} smoothness={3}>
            <meshStandardMaterial color={CHIP_COLOR} metalness={0.4} roughness={0.5} />
          </RoundedBox>
          <mesh position={[0, 0, 0.045]}>
            <planeGeometry args={[0.18, 0.18]} />
            <meshStandardMaterial color="#1b1e22" metalness={0.2} roughness={0.7} />
          </mesh>
        </>
      );
    case "mcu":
      return (
        <RoundedBox args={[0.17, 0.17, 0.055]} radius={0.012} smoothness={3}>
          <meshStandardMaterial color={CHIP_COLOR} metalness={0.4} roughness={0.5} />
        </RoundedBox>
      );
    case "modem":
      return (
        <RoundedBox args={[0.32, 0.22, 0.05]} radius={0.012} smoothness={3}>
          <meshStandardMaterial color="#1a1c1f" metalness={0.55} roughness={0.4} />
        </RoundedBox>
      );
    case "camera":
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.1, 24]} />
            <meshStandardMaterial color="#16181c" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <circleGeometry args={[0.06, 24]} />
            <meshPhysicalMaterial color={LENS_COLOR} metalness={0.1} roughness={0.05} clearcoat={1} />
          </mesh>
        </group>
      );
    case "battery":
      return (
        <RoundedBox args={[0.62, 0.85, 0.16]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color={METAL_COLOR} metalness={0.55} roughness={0.45} />
        </RoundedBox>
      );
    case "speaker":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.08, 28]} />
          <meshStandardMaterial color="#26282c" metalness={0.5} roughness={0.5} />
        </mesh>
      );
    default:
      return null;
  }
}

/** Inline GitHub mark — lucide-react v1 dropped brand icons. */
function GithubMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function TeardownLabel({ part }: { part: TeardownPart }) {
  const dir = part.labelSide === "right" ? 1 : -1;
  // Leader line from the part out to the label anchor. Kept short so the
  // labels stay on-screen in portrait (narrow horizontal FOV).
  const end: [number, number, number] = [dir * 0.42, part.labelY, 0.12];
  return (
    <group>
      <Line points={[[0, 0, 0], end]} color="#8a8f98" lineWidth={1} transparent opacity={0.7} />
      <mesh position={end}>
        <sphereGeometry args={[0.016, 12, 12]} />
        <meshBasicMaterial color="#8a8f98" />
      </mesh>
      <Html
        position={end}
        distanceFactor={3.4}
        style={{ pointerEvents: "none" }}
        zIndexRange={[20, 0]}
      >
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
 * The stylized Pneuma device: a soft 60×40×10 slab with a drafted 20mm
 * hump over the component stack (battery flat in the thin half). One
 * cohesive shell — in the teardown it ghosts translucent and lifts
 * while the internals slide out. Reads `explodeRef` each frame so a
 * parent only drives one number.
 */
export function DeviceModel({
  target,
  explodeRef,
  showInternals = true,
  showLabels = false,
  castShadow = true,
}: DeviceModelProps) {
  const baseMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const humpMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const humpRef = useRef<THREE.Group>(null);
  const partRefs = useRef<Record<string, THREE.Group | null>>({});

  // Drafted hump: footprint ~31×37mm, 20mm tall, ~10° taper on the top.
  const humpGeo = useDraftedHump(0.78, 0.92, 0.5, 0.16, 10);

  const lerpShell = (
    mat: THREE.MeshPhysicalMaterial | null,
    exploded: number,
    dt: number
  ) => {
    if (!mat) return;
    const k = 1 - Math.exp(-dt * 4);
    mat.color.lerp(target.color, k);
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, target.metalness, k);
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, target.roughness, k);
    mat.clearcoat = THREE.MathUtils.lerp(mat.clearcoat, target.clearcoat, k);
    // Ghost the shell open so the internals read in the teardown.
    const targetOpacity = 1 - exploded * 0.85;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, k);
  };

  useFrame((_, delta) => {
    const e = explodeRef.current;
    lerpShell(baseMat.current, e, delta);
    lerpShell(humpMat.current, e, delta);

    // Hump lifts slightly as it opens.
    if (humpRef.current) {
      humpRef.current.position.z = 0.125 + e * 0.25;
    }

    for (const part of TEARDOWN_PARTS) {
      const g = partRefs.current[part.id];
      if (!g) continue;
      g.position.set(
        part.rest[0] + part.explode[0] * e,
        part.rest[1] + part.explode[1] * e,
        part.rest[2] + part.explode[2] * e
      );
    }
  });

  return (
    <group>
      {/* --- Soft base slab (60×40×10) --- */}
      <RoundedBox
        args={[1.5, 1.0, 0.25]}
        radius={0.11}
        smoothness={8}
        castShadow={castShadow}
        receiveShadow
      >
        <meshPhysicalMaterial
          ref={baseMat}
          color={target.color}
          metalness={target.metalness}
          roughness={target.roughness}
          clearcoat={target.clearcoat}
          clearcoatRoughness={0.15}
          transparent
          opacity={1}
        />
      </RoundedBox>

      {/* --- Drafted hump over the stack, on the +X half --- */}
      <group ref={humpRef} position={[0.36, 0, 0.125]}>
        <mesh geometry={humpGeo} castShadow={castShadow} receiveShadow>
          <meshPhysicalMaterial
            ref={humpMat}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            opacity={1}
          />
        </mesh>
        {/* Camera lens + status LED on the hump's tapered top face. */}
        <mesh position={[0.16, 0.18, 0.26]}>
          <circleGeometry args={[0.06, 28]} />
          <meshPhysicalMaterial color={LENS_COLOR} metalness={0.2} roughness={0.05} clearcoat={1} />
        </mesh>
        <mesh position={[-0.18, -0.2, 0.26]}>
          <circleGeometry args={[0.016, 16]} />
          <meshStandardMaterial color="#7dd3a0" emissive="#3fae6e" emissiveIntensity={1.4} />
        </mesh>
      </group>

      {/* Side button on the thin half's edge. */}
      <mesh position={[-0.4, 0.5, 0.0]}>
        <boxGeometry args={[0.18, 0.04, 0.12]} />
        <meshStandardMaterial color="#2a2c30" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* --- Internals --- */}
      {showInternals && (
        <group>
          <group
            ref={(el) => {
              partRefs.current["pcb"] = el;
            }}
            position={[0.34, 0, 0.0]}
          >
            <RoundedBox args={[0.64, 0.82, 0.03]} radius={0.02} smoothness={3}>
              <meshStandardMaterial color={PCB_COLOR} metalness={0.2} roughness={0.65} />
            </RoundedBox>
          </group>

          {TEARDOWN_PARTS.map((part) => (
            <group
              key={part.id}
              ref={(el) => {
                partRefs.current[part.id] = el;
              }}
              position={part.rest}
            >
              <PartGeometry id={part.id} />
              {showLabels && <TeardownLabel part={part} />}
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
