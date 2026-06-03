"use client";

import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html, Line } from "@react-three/drei";
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

function PartGeometry({ id }: { id: string }) {
  switch (id) {
    case "soc":
      return (
        <>
          <RoundedBox args={[0.28, 0.28, 0.08]} radius={0.015} smoothness={3}>
            <meshStandardMaterial color={CHIP_COLOR} metalness={0.4} roughness={0.5} />
          </RoundedBox>
          {/* lid marking */}
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
            <cylinderGeometry args={[0.12, 0.12, 0.12, 24]} />
            <meshStandardMaterial color="#16181c" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, 0.065]}>
            <circleGeometry args={[0.075, 24]} />
            <meshPhysicalMaterial
              color={LENS_COLOR}
              metalness={0.1}
              roughness={0.05}
              clearcoat={1}
            />
          </mesh>
        </group>
      );
    case "battery":
      return (
        <RoundedBox args={[0.92, 0.52, 0.12]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color={METAL_COLOR} metalness={0.55} roughness={0.45} />
        </RoundedBox>
      );
    case "speaker":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.09, 28]} />
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
  // Leader line from the part out to the label anchor.
  const end: [number, number, number] = [dir * 0.55, part.labelY, 0.1];
  return (
    <group>
      <Line
        points={[
          [0, 0, 0],
          end,
        ]}
        color="#8a8f98"
        lineWidth={1}
        transparent
        opacity={0.7}
      />
      {/* anchor dot */}
      <mesh position={end}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color="#8a8f98" />
      </mesh>
      <Html
        position={end}
        center={part.labelSide === "left"}
        distanceFactor={6}
        style={{ pointerEvents: "none" }}
        zIndexRange={[20, 0]}
      >
        <div
          className="teardown-label-fade flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-background/85 px-1.5 py-0.5 text-[10px] font-medium tracking-tight text-foreground shadow-sm backdrop-blur"
          style={{
            transform: `translateX(${dir > 0 ? "0.4rem" : "-100%"}) translateX(${dir > 0 ? "0" : "-0.4rem"})`,
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
 * The stylized Pneuma device: a soft, draped aluminium pebble whose
 * top and bottom shell halves part and whose internals slide out in
 * the teardown stage. Self-contained — it reads `explodeRef` each
 * frame so a parent only has to drive one number.
 */
export function DeviceModel({
  target,
  explodeRef,
  showInternals = true,
  showLabels = false,
  castShadow = true,
}: DeviceModelProps) {
  const topRef = useRef<THREE.Group>(null);
  const bottomRef = useRef<THREE.Group>(null);
  const shellTopMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const shellBottomMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const partRefs = useRef<Record<string, THREE.Group | null>>({});

  const lerpShell = (mat: THREE.MeshPhysicalMaterial | null, exploded: number, dt: number) => {
    if (!mat) return;
    const k = 1 - Math.exp(-dt * 4);
    mat.color.lerp(target.color, k);
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, target.metalness, k);
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, target.roughness, k);
    mat.clearcoat = THREE.MathUtils.lerp(mat.clearcoat, target.clearcoat, k);
    // Fade the shell toward translucent as it opens so rear internals read.
    const targetOpacity = 1 - exploded * 0.72;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, k);
  };

  useFrame((_, delta) => {
    const e = explodeRef.current;

    // Shell halves part along Y.
    if (topRef.current) {
      topRef.current.position.y = 0.225 + e * 0.85;
    }
    if (bottomRef.current) {
      bottomRef.current.position.y = -0.225 - e * 0.5;
    }
    lerpShell(shellTopMat.current, e, delta);
    lerpShell(shellBottomMat.current, e, delta);

    // Internal parts slide along their explode vectors.
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
      {/* --- Top shell half --- */}
      <group ref={topRef} position={[0, 0.225, 0]}>
        <RoundedBox
          args={[1.5, 0.5, 0.52]}
          radius={0.22}
          smoothness={6}
          castShadow={castShadow}
          receiveShadow
        >
          <meshPhysicalMaterial
            ref={shellTopMat}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            opacity={1}
          />
        </RoundedBox>
        {/* Camera lens + LED dragged on the upper face. */}
        <mesh position={[0.32, -0.02, 0.27]}>
          <circleGeometry args={[0.075, 28]} />
          <meshPhysicalMaterial color={LENS_COLOR} metalness={0.2} roughness={0.05} clearcoat={1} />
        </mesh>
        <mesh position={[-0.34, 0.0, 0.27]}>
          <circleGeometry args={[0.018, 16]} />
          <meshStandardMaterial color="#7dd3a0" emissive="#3fae6e" emissiveIntensity={1.4} />
        </mesh>
      </group>

      {/* --- Bottom shell half --- */}
      <group ref={bottomRef} position={[0, -0.225, 0]}>
        <RoundedBox
          args={[1.5, 0.5, 0.52]}
          radius={0.22}
          smoothness={6}
          castShadow={castShadow}
          receiveShadow
        >
          <meshPhysicalMaterial
            ref={shellBottomMat}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            opacity={1}
          />
        </RoundedBox>
        {/* Side button. */}
        <mesh position={[0.76, 0.05, 0]}>
          <boxGeometry args={[0.04, 0.16, 0.18]} />
          <meshStandardMaterial color="#2a2c30" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* Speaker grille pill. */}
        <mesh position={[0, -0.14, 0.27]}>
          <planeGeometry args={[0.4, 0.06]} />
          <meshStandardMaterial color="#202226" metalness={0.3} roughness={0.7} />
        </mesh>
      </group>

      {/* --- Internals --- */}
      {showInternals && (
        <group>
          {/* Mainboard sits between the halves. */}
          <group
            ref={(el) => {
              partRefs.current["pcb"] = el;
            }}
            position={[0, 0, 0]}
          >
            <RoundedBox args={[1.06, 0.62, 0.04]} radius={0.03} smoothness={3}>
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
