"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { Frame } from "./choreography";
import { agentClock } from "./agent-timeline";

/**
 * The "printer": a circular, machined pedestal the device stands on, with
 * a glowing ring running in a groove around its circumference, a dark
 * glass top carrying holographic rings, and warm motes drifting up off it.
 * Only on the agents step: the enclosure materialises on it, and the
 * mascot's monitor is cabled into a port on its rim.
 *
 * Authored at radius 1 (top face at y = TOP) and scaled to
 * frame.platform.radius, top face on frame.platform.position.
 */

const TOP = 0.228;
const PORT_Y = 0.07;

/**
 * The rim port turns to face the monitor, wherever the layout puts it:
 * the cable then always arrives straight on from the monitor's side and
 * never has to pass through the platform's body. Angle in platform space
 * (x right, z toward camera), measured like the lathe: (cos a, −sin a).
 */
function portAngle(f: Frame): number {
  const d = f.desk.clone().sub(f.platform.position);
  d.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(f.orbitYaw ?? 0));
  return Math.atan2(-d.z, d.x);
}

/** World position of the rim port, and its outward direction. */
export function platformPort(
  f: Frame,
  out: { pos: THREE.Vector3; dir: THREE.Vector3 },
) {
  // Same transform as the component: top-face pivot, tilt about x, then
  // the drag-orbit yaw (YXZ: yaw outermost), scale.
  const a = portAngle(f);
  const r = f.platform.radius;
  const rot = new THREE.Euler(f.platform.tilt, f.orbitYaw ?? 0, 0, "YXZ");
  out.pos
    .set(Math.cos(a), PORT_Y - TOP, -Math.sin(a))
    .applyEuler(rot)
    .multiplyScalar(r)
    .add(f.platform.position);
  out.dir.set(Math.cos(a), 0, -Math.sin(a)).applyEuler(rot);
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

/**
 * A cheap bloom: a camera-facing ellipse of warm light spilling past the
 * glass, additively blended. A real bloom pass would re-render the whole
 * canvas every frame for one glowing disc; this is one quad.
 */
const HALO_FRAG = /* glsl */ `
  uniform float uGlow;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * vec2(2.0, 2.0);
    float d = length(c);
    float a = pow(max(0.0, 1.0 - d), 2.2) * (0.55 + 0.35 * exp(-uPulse * 2.5)) * uGlow;
    gl_FragColor = vec4(vec3(1.0, 0.84, 0.55) * a, a);
  }
`;

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
    float a = (1.0 + rings + sweep + ripple * 0.12) * (1.0 - smoothstep(0.97, 1.0, r));
    // Warm white, painted over the body (not added to it) so the metal's
    // lighting — which differs with each step's tilt and scale — can't
    // show through and make the glow read stronger on one step.
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * uGlow, clamp(a * 0.85, 0.0, 1.0));
  }
`;

/**
 * Motes: warm specks rising slowly off the glass, each on its own clock,
 * fading as they leave it. Positions are platform space (radius 1); the
 * vertex shader loops each one's height and hands the fragment its fade.
 */
const MOTES = 70;
const MOTE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  attribute float aSeed;
  varying float vA;
  void main() {
    float life = fract(uTime * (0.07 + 0.05 * aSeed) + aSeed * 7.13);
    vec3 p = position;
    p.y += life * (0.55 + 0.4 * aSeed);
    p.x += sin(uTime * 0.6 + aSeed * 20.0) * 0.03 * life;
    // In quickly off the glass, then gone well before the top.
    vA = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.35, 1.0, life)) * uGlow;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (3.6 + 3.6 * aSeed) * (300.0 / -mv.z) * 0.02;
  }
`;
const MOTE_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
  }
`;

function moteGeometry(): THREE.BufferGeometry {
  const pos = new Float32Array(MOTES * 3);
  const seed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    // Deterministic scatter over the disc (golden-angle spiral).
    const r = 0.85 * Math.sqrt((i + 0.5) / MOTES);
    const a = i * 2.39996;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    if (seed[i] < 0) seed[i] += 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return g;
}

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function HoloPlatform({
  frameRef,
  stepRef,
}: {
  frameRef: MutableRefObject<Frame | null>;
  stepRef: MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const portRef = useRef<THREE.Group>(null);
  const portMountRef = useRef<THREE.Group>(null);
  const fade = useRef(0);
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
        toneMapped: false,
      }),
      haloMat: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: UV_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        // It's a flat quad standing through the glass disc: depth-tested,
        // the disc cut its lower half off in a hard line. Bloom sits over
        // everything anyway.
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      motes: moteGeometry(),
      moteMat: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
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
    // Only while the agents step is the step: fades in with its arrival,
    // and out on its own ~150ms clock the moment the step changes — never
    // lingering under the device on the way back to steps 1–2.
    fade.current =
      stepRef.current === 2
        ? Math.max(fade.current, THREE.MathUtils.smoothstep(f.agent, 0.05, 0.6))
        : Math.max(0, fade.current - Math.min(delta, 1 / 20) * 7);
    const o = fade.current;
    group.visible = o > 0.01;
    if (!group.visible) return;
    clock.current += delta;
    const r = f.platform.radius;
    // Pivot on the top face so the tilt keeps the device seated on it.
    group.position.copy(f.platform.position);
    group.rotation.set(f.platform.tilt, f.orbitYaw ?? 0, 0, "YXZ");
    group.scale.setScalar(r);

    // Deliveries land on the shared agent clock (agent-timeline.ts).
    uniforms.uTime.value = clock.current;
    uniforms.uPulse.value = agentClock.sinceArrival;
    uniforms.uGlow.value = o;
    group.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || m instanceof THREE.ShaderMaterial) return;
      m.transparent = o < 0.999;
      m.opacity = o;
    });
    // The port only exists for the agents step's hose; it sits on the
    // front rim, so elsewhere it would read as a stray nub.
    const mount = portMountRef.current;
    if (mount) {
      const a = portAngle(f);
      mount.position.set(Math.cos(a), PORT_Y, -Math.sin(a));
      mount.rotation.set(0, a, 0);
    }
    const port = portRef.current;
    if (port) {
      port.visible = f.agent > 0.01;
      port.scale.setScalar(Math.max(f.agent, 1e-3));
    }
    const ring = ringRef.current;
    if (ring) {
      const flash = Math.exp(-agentClock.sinceArrival * 3.5);
      // Warm amber, flaring toward white-hot as a delivery lands.
      (ring.material as THREE.MeshBasicMaterial).color.setRGB(
        1,
        0.9 + flash * 0.1,
        0.72 + flash * 0.2,
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
          <meshBasicMaterial color="#ffe6b8" toneMapped={false} />
        </mesh>
        {/* Holographic glass top. */}
        <mesh
          position={[0, TOP - 0.006, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={g.glassMat}
        >
          <circleGeometry args={[0.885, 96]} />
        </mesh>
        {/* Bloom: warm light spilling past the rim, facing the camera. */}
        <Billboard position={[0, TOP + 0.05, 0]}>
          <mesh material={g.haloMat} renderOrder={3}>
            <planeGeometry args={[3.4, 1.5]} />
          </mesh>
        </Billboard>
        {/* Warm motes drifting up off the glass. */}
        <points
          geometry={g.motes}
          material={g.moteMat}
          position={[0, TOP, 0]}
          frustumCulled={false}
        />
        {/* Rim port: a small flush boss the hose plugs into. */}
        <group ref={portMountRef}>
          <group ref={portRef}>
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
    </group>
  );
}
