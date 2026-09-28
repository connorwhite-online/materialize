"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";
import { agentClock } from "./agent-timeline";

/**
 * The "printer": a circular, machined pedestal the device stands on, with
 * a glowing ring running in a groove around its circumference, a dark
 * glass top carrying holographic rings, and a faint beam lifting the part.
 * It sits under the device on every step; the agents step pulls back to
 * show all of it, with the mascot's hose plugged into a port on its rim.
 *
 * Authored at radius 1 (top face at y = TOP) and scaled to
 * frame.platform.radius, top face on frame.platform.position.
 */

const TOP = 0.228;
/** Rim port, platform space: back-left, on the lower band. */
const PORT_ANGLE = Math.PI * 1.18;
const PORT_Y = 0.07;
export const PORT_LOCAL = new THREE.Vector3(
  Math.cos(PORT_ANGLE) * 1.0,
  PORT_Y,
  -Math.sin(PORT_ANGLE) * 1.0,
);
/** Straight out of the port (radial), platform space. */
export const PORT_OUT = new THREE.Vector3(
  Math.cos(PORT_ANGLE),
  0,
  -Math.sin(PORT_ANGLE),
);

/** World position of the rim port, and its outward direction. */
export function platformPort(
  f: Frame,
  out: { pos: THREE.Vector3; dir: THREE.Vector3 },
) {
  // Same transform as the component: top-face pivot, tilt about x, scale.
  const r = f.platform.radius;
  const tilt = new THREE.Euler(f.platform.tilt, 0, 0);
  out.pos
    .copy(PORT_LOCAL)
    .add(new THREE.Vector3(0, -TOP, 0))
    .applyEuler(tilt)
    .multiplyScalar(r)
    .add(f.platform.position);
  out.dir.copy(PORT_OUT).applyEuler(tilt);
  return out;
}

/** Rounded pedestal with a groove running round it. (radius, height) */
function bodyProfile(): THREE.Vector2[] {
  const p = (r: number, y: number) => new THREE.Vector2(r, y);
  return [
    p(0, 0),
    p(0.9, 0),
    p(0.965, 0.008),
    p(0.99, 0.025),
    p(1.0, 0.05),
    p(1.0, 0.092),
    // The groove: a soft U cut into the band.
    p(0.985, 0.1),
    p(0.962, 0.108),
    p(0.955, 0.12),
    p(0.962, 0.132),
    p(0.985, 0.14),
    p(1.0, 0.148),
    p(1.0, 0.19),
    // Rounded top edge rolling onto a small lip, then a shallow recess
    // the glass sits in.
    p(0.993, 0.207),
    p(0.978, 0.22),
    p(0.955, TOP),
    p(0.9, TOP),
    p(0.885, TOP - 0.008),
    p(0, TOP - 0.008),
  ];
}

const uniforms = {
  uTime: { value: 0 },
  uPulse: { value: 10 }, // seconds since the last delivery landed
  uGlow: { value: 1 },
};

const GLASS_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uGlow;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    // Fine concentric rings, a slow scan sweep, fading to the edge.
    float rings = smoothstep(0.92, 1.0, fract(r * 14.0)) * 0.05;
    float ang = atan(c.y, c.x);
    float sweep = pow(max(0.0, cos(ang - uTime * 0.9)), 18.0) * 0.04;
    // A delivery lands: a ripple runs out from the centre.
    float ripple = exp(-pow((r - uPulse * 1.6) * 7.0, 2.0)) * exp(-uPulse * 2.2);
    // A gentle, even glow across the whole disc; the detail barely rides
    // on it, so it reads as one lit plane, not a hot spot.
    float a = (0.2 + rings + sweep + ripple * 0.12) * (1.0 - smoothstep(0.97, 1.0, r));
    gl_FragColor = vec4(vec3(1.0, 0.52, 0.18) * a * uGlow, a * uGlow);
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  varying vec2 vUv;
  void main() {
    // Brightest at the base, gone by the top; a print line scans upward.
    float base = pow(1.0 - vUv.y, 2.4) * 0.05;
    float scan = exp(-pow((vUv.y - fract(uTime * 0.35)) * 40.0, 2.0)) * 0.08;
    float a = (base + scan) * uGlow;
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * a, a);
  }
`;

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function HoloPlatform({
  frameRef,
}: {
  frameRef: MutableRefObject<Frame | null>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const clock = useRef(0);

  const g = useMemo(
    () => ({
      body: new THREE.LatheGeometry(bodyProfile(), 128),
      glassMat: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: UV_VERT,
        fragmentShader: GLASS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      beamMat: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: UV_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }),
    [],
  );

  useFrame((_, delta) => {
    const f = frameRef.current;
    const group = groupRef.current;
    if (!f || !group) return;
    clock.current += delta;
    const r = f.platform.radius;
    // Pivot on the top face so the tilt keeps the device seated on it.
    group.position.copy(f.platform.position);
    group.rotation.x = f.platform.tilt;
    group.scale.setScalar(r);

    // Deliveries land on the shared agent clock (agent-timeline.ts).
    uniforms.uTime.value = clock.current;
    uniforms.uPulse.value = agentClock.sinceArrival;
    // Same brightness on every step.
    uniforms.uGlow.value = 1;
    const ring = ringRef.current;
    if (ring) {
      const flash = Math.exp(-agentClock.sinceArrival * 3.5);
      // Warm amber, flaring toward white-hot as a delivery lands.
      (ring.material as THREE.MeshBasicMaterial).color.setRGB(
        1,
        0.5 + flash * 0.12,
        0.16 + flash * 0.12,
      );
    }
  });

  return (
    <group ref={groupRef}>
      <group position={[0, -TOP, 0]}>
        {/* Machined body: dark satin metal. */}
        <mesh geometry={g.body}>
          <meshStandardMaterial
            color="#1b1d22"
            metalness={0.65}
            roughness={0.34}
          />
        </mesh>
        {/* Light ring glowing in the groove. */}
        <mesh
          ref={ringRef}
          position={[0, 0.12, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.957, 0.009, 10, 160]} />
          <meshBasicMaterial color="#ff812a" toneMapped={false} />
        </mesh>
        {/* Holographic glass top. */}
        <mesh
          position={[0, TOP - 0.006, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={g.glassMat}
        >
          <circleGeometry args={[0.885, 96]} />
        </mesh>
        {/* Faint lifting beam. */}
        <mesh position={[0, TOP + 0.8, 0]} material={g.beamMat}>
          <cylinderGeometry args={[0.62, 0.84, 1.6, 64, 1, true]} />
        </mesh>
        {/* Rim port: a small flush boss the hose plugs into. */}
        <group position={PORT_LOCAL.toArray()} rotation={[0, PORT_ANGLE, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[0.012, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.056, 0.03, 32]} />
            <meshStandardMaterial
              color="#8d9198"
              metalness={1}
              roughness={0.28}
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[0.028, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.006, 24]} />
            <meshStandardMaterial color="#0e0f12" roughness={0.6} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
