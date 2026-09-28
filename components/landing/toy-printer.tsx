"use client";

import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Frame } from "./choreography";
import { agentClock } from "./agent-timeline";

/**
 * The agents step's printer: a stylised, toy-like cube-frame FDM printer
 * the mascot's monitor is cabled into. It prints on its own loop — the
 * bed slides, the head sweeps, the gantry climbs as the part grows — and
 * the nozzle flares each time a delivery lands down the cable
 * (agentClock). Only on the agents step.
 *
 * Authored with its footprint ~2 units wide, origin at the centre of its
 * base's underside; placed on frame.platform (the stage the choreography
 * reserves for it) and scaled by frame.platform.radius.
 */

/** Turned a little toward the monitor on its left. */
const YAW = 0.42;
/** Cable port on the base's left flank, and straight out of it. */
const PORT_LOCAL = new THREE.Vector3(-1.08, 0.17, 0.35);
const PORT_OUT = new THREE.Vector3(-1, 0, 0);
/** How far below the stage anchor the base sits, in printer units. */
const DROP = 0.9;
const PRINT_LOOP_S = 9;
const BED_Y = 0.36;

const WARM_WHITE = "#ebe6de";
const CHARCOAL = "#2a2b30";
const ORANGE = "#d97757";

function placement(f: Frame) {
  const s = f.platform.radius * 0.6;
  const pos = f.platform.position
    .clone()
    .add(new THREE.Vector3(0, -DROP * s, 0));
  return { s, pos };
}

/** World position of the cable port, and its outward direction. */
export function printerPort(
  f: Frame,
  out: { pos: THREE.Vector3; dir: THREE.Vector3 },
) {
  const { s, pos } = placement(f);
  const yaw = new THREE.Euler(0, YAW, 0);
  out.pos.copy(PORT_LOCAL).applyEuler(yaw).multiplyScalar(s).add(pos);
  out.dir.copy(PORT_OUT).applyEuler(yaw);
  return out;
}

export function ToyPrinter({
  frameRef,
}: {
  frameRef: MutableRefObject<Frame | null>;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bedRef = useRef<THREE.Group>(null);
  const gantryRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const partRef = useRef<THREE.Mesh>(null);
  const layerRef = useRef<THREE.Mesh>(null);
  const tipRef = useRef<THREE.Mesh>(null);
  const spoolRef = useRef<THREE.Group>(null);
  const clock = useRef(0);

  useFrame((_, rawDelta) => {
    const f = frameRef.current;
    const root = rootRef.current;
    if (!f || !root) return;
    const o = THREE.MathUtils.smoothstep(f.agent, 0.5, 1);
    root.visible = o > 0.01;
    if (!root.visible) return;
    clock.current += Math.min(rawDelta, 1 / 20);
    const t = clock.current;
    const { s, pos } = placement(f);
    root.position.copy(pos);
    root.scale.setScalar(s);
    setOpacity(root, o);

    // Prusa-style kinematics: bed on Y (z here), head on X, gantry on Z.
    // Together the nozzle traces the part's outline relative to the bed.
    const phase = t * 4.2;
    const loop = (t % PRINT_LOOP_S) / PRINT_LOOP_S;
    const h = 0.04 + 0.5 * loop; // part height
    bedRef.current!.position.z = Math.cos(phase) * 0.22;
    headRef.current!.position.x = Math.sin(phase) * 0.22;
    gantryRef.current!.position.y = BED_Y + 0.04 + h + 0.2;
    partRef.current!.scale.y = h;
    partRef.current!.position.y = h / 2;
    layerRef.current!.position.y = h;
    spoolRef.current!.rotation.z = -t * 0.6;

    // Nozzle glows; flares white-hot as a delivery lands.
    const flash = Math.exp(-agentClock.sinceArrival * 3);
    const tip = tipRef.current!.material as THREE.MeshBasicMaterial;
    tip.color.setRGB(1, 0.62 + 0.35 * flash, 0.3 + 0.6 * flash);
  });

  return (
    <group ref={rootRef} rotation={[0, YAW, 0]}>
      {/* Base, with a little status screen. */}
      <RoundedBox
        args={[2.1, 0.34, 1.7]}
        radius={0.1}
        smoothness={4}
        position={[0, 0.17, 0]}
      >
        <meshStandardMaterial color={WARM_WHITE} roughness={0.55} />
      </RoundedBox>
      <mesh position={[0.55, 0.17, 0.851]}>
        <planeGeometry args={[0.46, 0.16]} />
        <meshBasicMaterial color="#ffb070" toneMapped={false} />
      </mesh>
      <mesh position={[0.55, 0.17, 0.849]}>
        <planeGeometry args={[0.52, 0.22]} />
        <meshStandardMaterial color={CHARCOAL} roughness={0.4} />
      </mesh>
      {/* Cable port. */}
      <mesh position={PORT_LOCAL.toArray()} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.11, 0.06, 24]} />
        <meshStandardMaterial color="#9ca0a7" metalness={1} roughness={0.3} />
      </mesh>

      {/* Bed (slides front–back) carrying the part being printed. */}
      <group ref={bedRef} position={[0, BED_Y, 0.12]}>
        <RoundedBox args={[1.45, 0.06, 1.2]} radius={0.025} smoothness={3}>
          <meshStandardMaterial
            color="#1f2024"
            roughness={0.35}
            metalness={0.3}
          />
        </RoundedBox>
        <group position={[0, 0.03, 0]}>
          <mesh ref={partRef}>
            <cylinderGeometry args={[0.24, 0.26, 1, 32]} />
            <meshStandardMaterial color={ORANGE} roughness={0.5} />
          </mesh>
          {/* The fresh layer, still hot. */}
          <mesh ref={layerRef}>
            <cylinderGeometry args={[0.245, 0.245, 0.018, 32]} />
            <meshBasicMaterial color="#ffc27a" toneMapped={false} />
          </mesh>
        </group>
      </group>

      {/* Frame: two uprights and a top bar, behind the bed. */}
      {[-0.98, 0.98].map((x) => (
        <RoundedBox
          key={x}
          args={[0.16, 1.55, 0.2]}
          radius={0.05}
          smoothness={3}
          position={[x, 0.34 + 0.77, -0.62]}
        >
          <meshStandardMaterial color={CHARCOAL} roughness={0.45} />
        </RoundedBox>
      ))}
      <RoundedBox
        args={[2.12, 0.16, 0.22]}
        radius={0.06}
        smoothness={3}
        position={[0, 1.9, -0.62]}
      >
        <meshStandardMaterial color={CHARCOAL} roughness={0.45} />
      </RoundedBox>

      {/* Gantry (climbs with the print) and the print head on it. */}
      <group ref={gantryRef}>
        <RoundedBox
          args={[1.9, 0.1, 0.12]}
          radius={0.04}
          smoothness={3}
          position={[0, 0.2, -0.62]}
        >
          <meshStandardMaterial
            color="#8e9298"
            metalness={0.8}
            roughness={0.3}
          />
        </RoundedBox>
        <group ref={headRef} position={[0, 0.2, 0]}>
          {/* Arm back to the gantry. */}
          <mesh position={[0, 0, -0.34]}>
            <boxGeometry args={[0.12, 0.08, 0.5]} />
            <meshStandardMaterial
              color="#8e9298"
              metalness={0.8}
              roughness={0.3}
            />
          </mesh>
          <RoundedBox args={[0.34, 0.3, 0.3]} radius={0.07} smoothness={4}>
            <meshStandardMaterial color={ORANGE} roughness={0.5} />
          </RoundedBox>
          <mesh position={[0, -0.2, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.06, 0.12, 16]} />
            <meshStandardMaterial
              color="#b9a27a"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
          <mesh ref={tipRef} position={[0, -0.27, 0]}>
            <sphereGeometry args={[0.025, 12, 8]} />
            <meshBasicMaterial color="#ff9e4d" toneMapped={false} />
          </mesh>
        </group>
      </group>

      {/* Filament spool on the right upright. */}
      <group position={[1.14, 1.35, -0.62]}>
        <group ref={spoolRef} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <torusGeometry args={[0.24, 0.1, 12, 32]} />
            <meshStandardMaterial color={ORANGE} roughness={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.36, 0.36, 0.03, 32]} />
            <meshStandardMaterial
              color={WARM_WHITE}
              roughness={0.5}
              transparent
              userData={{ baseOpacity: 0.9 }}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** Fade every material under `group`, keeping each one's base opacity. */
function setOpacity(group: THREE.Object3D, o: number) {
  group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | undefined;
    if (!m) return;
    m.transparent = o < 0.999 || m.userData.baseOpacity !== undefined;
    m.opacity = o * ((m.userData.baseOpacity as number | undefined) ?? 1);
    m.depthWrite = o > 0.5;
  });
}
