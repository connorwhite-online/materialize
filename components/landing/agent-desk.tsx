"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";
import { PACKET_LAUNCH_S, PACKET_TRAVEL_S, agentClock } from "./agent-timeline";
import { platformPort } from "./holo-platform";

/**
 * The agents step: the Claude Code mascot, built from voxels and toon-
 * shaded to read like its flat 2D sprite, jams on a little laptop. A hose
 * loops back from the laptop into a port on the printer platform's rim
 * (holo-platform.tsx); bulges swell along it as each piece of work is
 * sent, easing into the port, and the platform ripples as each lands
 * (agentClock in agent-timeline.ts).
 *
 * Everything is authored in "agent units" (1 ≈ the mascot's height) and
 * scaled by frame.agentUnit, so desktop and phone share one model.
 */

// ─── Mascot ───────────────────────────────────────────────────────────

/**
 * Front silhouette, top row first. B body, E eye, A arm (animated), L leg.
 * Extruded 3 voxels deep. Approximates the Claude Code pixel mascot —
 * swap in the official sprite here if it's to be exact.
 */
const MASCOT = [
  "..BBBBBBBB..",
  "..BBBBBBBB..",
  "..BEBBBBEB..",
  "..BEBBBBEB..",
  "AABBBBBBBBAA", // ARM_ROW: stubs rigged as arms (mascotVoxels)
  "..BBBBBBBB..",
  "..BBBBBBBB..",
  "..L.L..L.L..",
  "..L.L..L.L..",
];
const DEPTH = 3;
const V = 1 / MASCOT.length; // voxel size: mascot is 1 unit tall
const ORANGE = "#d97757";

interface Voxels {
  body: THREE.Matrix4[];
  eyes: THREE.Matrix4[];
  armL: THREE.Matrix4[];
  armR: THREE.Matrix4[];
}

/** Shoulder pivots, mascot space: the body's side edge at the arm row. */
const ARM_ROW = 4;
const SHOULDER_Y = (MASCOT.length - 1 - ARM_ROW) * V + V / 2;
const SHOULDER_X = 4 * V; // body spans 8 columns
/** Forearm length in voxels — long enough to land on the keyboard. */
const FOREARM = 2; // short, so he has to lean over the keys

function mascotVoxels(): Voxels {
  const out: Voxels = { body: [], eyes: [], armL: [], armR: [] };
  const cols = MASCOT[0].length;
  const m = new THREE.Matrix4();
  MASCOT.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      // Arms are rigged separately below, not part of the body mesh.
      if (ch === "." || ch === "A") return;
      for (let d = 0; d < DEPTH; d++) {
        const x = (c - (cols - 1) / 2) * V;
        const y = (MASCOT.length - 1 - r) * V + V / 2;
        const z = (d - (DEPTH - 1) / 2) * V;
        // Eyes only on the front face; behind them is body.
        const kind = ch === "E" && d === DEPTH - 1 ? "eyes" : "body";
        out[kind].push(m.clone().makeTranslation(x, y, z));
      }
    });
  });
  // Each arm in its own pivot space (origin = shoulder): the signature side
  // stub (2 voxels out), then a forearm reaching forward (+z) to the keys.
  // Rotating the pivot about x swings the forearm down onto the keyboard.
  for (const [side, list] of [
    [-1, out.armL],
    [1, out.armR],
  ] as const) {
    const cell = (x: number, z: number) =>
      list.push(m.clone().makeTranslation(side * x * V, 0, z * V));
    cell(0.5, 0);
    cell(1.5, 0);
    for (let i = 1; i <= FOREARM; i++) cell(1.5, i);
  }
  return out;
}

// ─── Hose ─────────────────────────────────────────────────────────────

const HOSE_SEGMENTS = 120;
const HOSE_RADIUS = 0.035;
const MAX_PACKETS = PACKET_LAUNCH_S.length;
/** Module-level like the burn-sweep uniforms: one hose, mutated per frame. */
const hoseUniforms = {
  uPackets: { value: new Array<number>(PACKET_LAUNCH_S.length).fill(-1) },
  // Per-bulge size: swells leaving the laptop, squeezes down into the port.
  uAmps: { value: new Array<number>(PACKET_LAUNCH_S.length).fill(0) },
  uFade: { value: 0 },
};

function hoseMaterial(uniforms: {
  uPackets: { value: number[] };
  uAmps: { value: number[] };
  uFade: { value: number };
}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: "#26272c",
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const decl = /* glsl */ `
      uniform float uPackets[${MAX_PACKETS}];
      uniform float uAmps[${MAX_PACKETS}];
      uniform float uFade;
      varying float vMzBulge;
      float mzBulge(float u) {
        float b = 0.0;
        for (int i = 0; i < ${MAX_PACKETS}; i++) {
          float d = (u - uPackets[i]) * 16.0;
          b = max(b, exp(-d * d) * uAmps[i]);
        }
        return b;
      }`;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${decl}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vMzBulge = mzBulge(uv.x);
         // Swell outward: the bulge is a packet squeezing down the hose.
         transformed += normal * vMzBulge * ${(HOSE_RADIUS * 1.6).toFixed(4)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uFade;\nvarying float vMzBulge;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += vec3(1.0, 0.52, 0.18) * vMzBulge * 1.6;`,
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.a *= uFade;",
      );
  };
  m.customProgramCacheKey = () => "mz-hose";
  return m;
}

// ─── Scene ────────────────────────────────────────────────────────────

export function AgentDesk({
  frameRef,
  stepRef,
}: {
  frameRef: MutableRefObject<Frame | null>;
  stepRef: MutableRefObject<number>;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const deskRef = useRef<THREE.Group>(null);
  const mascotRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const eyesRef = useRef<THREE.Group>(null);
  const hoseRef = useRef<THREE.Mesh>(null);
  const collarRef = useRef<THREE.Group>(null);
  const screenLinesRef = useRef<THREE.Group>(null);
  const clock = useRef({
    t: 0,
    onStep: false,
    layoutKey: "",
    // Each arm eases after its target through a spring (angle, velocity),
    // and runs its own tap phase so the hands never fall into lockstep.
    armL: { x: ARM_REST, v: 0, phase: 0 },
    armR: { x: ARM_REST, v: 0, phase: 1.7 },
  });

  const built = useMemo(
    () => ({
      vox: mascotVoxels(),
      box: new THREE.BoxGeometry(V, V, V),
      hoseMat: hoseMaterial(hoseUniforms),
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const f = frameRef.current;
    const root = rootRef.current;
    if (!f || !root) return;
    const delta = Math.min(rawDelta, 1 / 20);
    const w = f.agent;
    root.visible = w > 0.01;
    const c = clock.current;
    // The clock restarts on every arrival at the agents step (2).
    const onStep = stepRef.current === 2;
    if (onStep && !c.onStep) c.t = 0;
    c.onStep = onStep;
    if (!root.visible) {
      agentClock.sinceArrival = 10;
      return;
    }
    c.t += delta;
    const t = c.t;
    const u = f.agentUnit;
    const appear = THREE.MathUtils.smoothstep(w, 0, 1);

    const desk = deskRef.current!;
    // Grows in from / shrinks to nothing in place, in step with the hose
    // fade — never a hard pop at the end of the transition.
    desk.position.copy(f.desk);
    desk.scale.setScalar(u * Math.max(appear, 1e-3));

    // ── Hose into the platform's rim port (rebuilt when either end moves) ──
    const port = platformPort(f, portScratch);
    const key = `${f.desk.x.toFixed(3)},${f.desk.y.toFixed(3)},${port.pos.x.toFixed(3)},${port.pos.y.toFixed(3)},${u.toFixed(3)}`;
    if (key !== c.layoutKey) {
      c.layoutKey = key;
      layoutHose(hoseRef.current, collarRef.current, f, u, port);
    }

    // ── Mascot: jamming, irregularly ──
    // Layered value noise, never a single sine, so it never visibly loops:
    // bursts of fast typing, little pauses to think, a lean that drifts,
    // a sway at frequencies that never line up. Each send is an Enter
    // flourish with a proper ease (up, hold, settle back in).
    let enter = 0;
    for (const launch of PACKET_LAUNCH_S)
      enter = Math.max(enter, flourish(t - launch + 0.12));
    const typing = 1 - enter;
    const burst = THREE.MathUtils.smoothstep(noise1(t * 0.45 + 11), 0.32, 0.62);
    const mascot = mascotRef.current!;
    mascot.rotation.x =
      0.3 + // leaning in to reach the keys
      (noise1(t * 0.55 + 3) - 0.5) * 0.12 * typing +
      0.05 * burst * typing -
      enter * 0.24;
    mascot.rotation.z = (noise1(t * 0.8 + 7) - 0.5) * 0.14 * typing;
    mascot.rotation.y = (noise1(t * 0.35 + 21) - 0.5) * 0.16;
    let bob = 0;
    for (const [arm, ref, seed] of [
      [c.armL, armLRef, 0],
      [c.armR, armRRef, 5],
    ] as const) {
      // Tap rate wanders between ~9 and ~17 strikes a second.
      arm.phase += delta * (9 + 8 * noise1(t * 0.7 + seed)) * Math.PI;
      const strike = Math.pow(Math.max(0, Math.sin(arm.phase)), 3);
      const hover = (1 - burst) * 0.1; // hands lift a touch while thinking
      const target =
        ARM_REST - strike * 0.3 * burst * typing - hover * typing - enter * 2.1;
      // Critically-damped-ish spring: eases every move, no snapping.
      arm.v += ((target - arm.x) * 420 - arm.v * 36) * delta;
      arm.x += arm.v * delta;
      ref.current!.rotation.x = arm.x;
      bob += strike * burst;
    }
    mascot.position.y = bob * V * 0.08 * typing + enter * V * 0.7;
    eyesRef.current!.scale.y = blink(t);

    const lines = screenLinesRef.current!;
    lines.children.forEach((line, i) => {
      const y = (i * 0.06 + t * (0.06 + 0.08 * burst)) % 0.33;
      line.position.y = y;
      line.visible = y < 0.3;
    });

    // ── Bulges down the hose, easing into the port ──
    const packets = hoseUniforms.uPackets.value;
    const amps = hoseUniforms.uAmps.value;
    let since = 10;
    PACKET_LAUNCH_S.forEach((launch, i) => {
      const p = (t - launch) / PACKET_TRAVEL_S;
      if (p < 0 || p > 1) {
        packets[i] = -1;
        amps[i] = 0;
      } else {
        packets[i] = easeInOutSine(p);
        // Swell out of the laptop, squeeze down to nothing entering the
        // port — never a pop at either end.
        amps[i] =
          THREE.MathUtils.smoothstep(p, 0, 0.1) *
          (1 - THREE.MathUtils.smoothstep(p, 0.8, 1));
      }
      if (t - launch - PACKET_TRAVEL_S >= 0)
        since = Math.min(since, t - launch - PACKET_TRAVEL_S);
    });
    hoseUniforms.uFade.value = appear;
    agentClock.t = t;
    agentClock.sinceArrival = since;
  });

  const { vox, box, hoseMat } = built;
  return (
    <group ref={rootRef}>
      <group ref={deskRef}>
        {/* Turned three-quarters so the mascot's face shows over the lid. */}
        <group rotation={[0.12, 0.55, 0]}>
          <group ref={mascotRef}>
            <Voxels matrices={vox.body} geometry={box} color={ORANGE} />
            <group ref={armLRef} position={[-SHOULDER_X, SHOULDER_Y, 0]}>
              <Voxels matrices={vox.armL} geometry={box} color={ORANGE} />
            </group>
            <group ref={armRRef} position={[SHOULDER_X, SHOULDER_Y, 0]}>
              <Voxels matrices={vox.armR} geometry={box} color={ORANGE} />
            </group>
            <group ref={eyesRef} position={[0, 0.72, 0]}>
              <group position={[0, -0.72, 0]}>
                <Voxels matrices={vox.eyes} geometry={box} color="#161616" />
              </group>
            </group>
          </group>
          <Laptop linesRef={screenLinesRef} />
        </group>
      </group>
      <mesh ref={hoseRef} material={hoseMat} frustumCulled={false} />
      {/* Where the hose meets the port: a short knurled metal collar. */}
      <group ref={collarRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.35, 1.35, 2.6, 24]} />
          <meshStandardMaterial color="#9ca0a7" metalness={1} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.55]}>
          <cylinderGeometry args={[1.12, 1.35, 0.5, 24]} />
          <meshStandardMaterial
            color="#7d8188"
            metalness={1}
            roughness={0.35}
          />
        </mesh>
      </group>
    </group>
  );
}

const portScratch = { pos: new THREE.Vector3(), dir: new THREE.Vector3() };

/** Resting arm angle: forearms laid on the keys. */
const ARM_REST = 1.25;

/** Smooth 1D value noise in [0, 1]. */
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const k = f * f * (3 - 2 * f);
  return h(i) * (1 - k) + h(i + 1) * k;
}

/** Enter flourish, 0 → 1 → 0 over ~0.6s: quick up, brief hold, eased back. */
function flourish(x: number): number {
  if (x <= 0 || x >= 0.62) return 0;
  if (x < 0.16) return THREE.MathUtils.smoothstep(x, 0, 0.16);
  if (x < 0.26) return 1;
  return 1 - THREE.MathUtils.smoothstep(x, 0.26, 0.62);
}

/** Blinks at irregular intervals (~2.5–5s apart). */
function blink(t: number): number {
  const cycle = 3.4 + (noise1(Math.floor(t / 3.4) * 1.7) - 0.5) * 1.8;
  return t % cycle > cycle - 0.14 ? 0.1 : 1;
}

// ─── Toon shading ─────────────────────────────────────────────────────

/**
 * A hard three-step ramp: the voxels read as flat 2D shapes with a crisp
 * light and shadow band, like the mascot's sprite, not soft 3D.
 */
const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(
    new Uint8Array([110, 190, 255]),
    3,
    1,
    THREE.RedFormat,
  );
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

function Voxels({
  matrices,
  geometry,
  color,
}: {
  matrices: THREE.Matrix4[];
  geometry: THREE.BoxGeometry;
  color: string;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh || mesh.userData.filled) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.filled = true;
  });
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, matrices.length]}>
      <meshToonMaterial color={color} gradientMap={TOON_RAMP} />
    </instancedMesh>
  );
}

/**
 * Blocky laptop in front of the mascot, used the right way round: hinge
 * on the FAR side, lid leaning back away from him, screen facing him —
 * from the camera we look over the back of the lid at him working. (It
 * first shipped reversed: hinge on his side, lid leaning into him.)
 */
function Laptop({
  linesRef,
}: {
  linesRef: MutableRefObject<THREE.Group | null>;
}) {
  const lineWidths = [0.34, 0.22, 0.4, 0.28, 0.18, 0.36];
  return (
    <group position={[0, 0.02, 0.48]} scale={0.8}>
      {/* Base */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.95, 0.06, 0.6]} />
        <meshToonMaterial color="#b9bdc4" gradientMap={TOON_RAMP} />
      </mesh>
      {/* Keyboard: dark key rows on the deck, under his hands. */}
      {[-0.16, -0.06, 0.04].map((z) => (
        <mesh key={z} position={[0, 0.062, z]}>
          <boxGeometry args={[0.78, 0.008, 0.07]} />
          <meshToonMaterial color="#2c2e34" gradientMap={TOON_RAMP} />
        </mesh>
      ))}
      {/* Lid on the far hinge, leaning back away from him; short enough
          that his eyes clear it. Its back faces the camera. */}
      <group position={[0, 0.06, 0.28]} rotation={[0.28, 0, 0]}>
        <mesh position={[0, 0.23, 0]}>
          <boxGeometry args={[0.95, 0.46, 0.04]} />
          <meshToonMaterial color="#b9bdc4" gradientMap={TOON_RAMP} />
        </mesh>
        {/* Screen (mascot side) with scrolling code */}
        <group position={[0, 0.07, -0.025]} rotation={[0, Math.PI, 0]}>
          <mesh position={[0, 0.17, 0]}>
            <planeGeometry args={[0.85, 0.38]} />
            <meshBasicMaterial color="#0d1220" toneMapped={false} />
          </mesh>
          <group ref={linesRef} position={[-0.38, 0.02, 0.001]}>
            {lineWidths.map((lw, i) => (
              <mesh key={i} position={[lw / 2, 0, 0]}>
                <planeGeometry args={[lw, 0.022]} />
                <meshBasicMaterial
                  color={i % 3 === 0 ? "#ffc27a" : "#d9774f"}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
/**
 * Hose from the laptop's side, sagging down and across into the port on
 * the platform's front rim, arriving straight on (along the port's
 * outward axis) so it reads as plugged in. The collar sits on the port.
 */
function layoutHose(
  mesh: THREE.Mesh | null,
  collar: THREE.Group | null,
  f: Frame,
  u: number,
  port: { pos: THREE.Vector3; dir: THREE.Vector3 },
) {
  if (!mesh || !collar) return;
  const radius = HOSE_RADIUS * u;
  const start = f.desk
    .clone()
    .add(new THREE.Vector3(0.5 * u, 0.12 * u, 0.25 * u));
  const collarLen = radius * 2.6;
  const entry = port.pos.clone().addScaledVector(port.dir, collarLen);
  const span = start.distanceTo(entry);
  const curve = new THREE.CatmullRomCurve3(
    [
      start,
      // Down off the desk in a lazy sag…
      start
        .clone()
        .lerp(entry, 0.4)
        .add(new THREE.Vector3(0, -0.22 * span, 0.12 * span)),
      // …and straight into the port.
      entry.clone().addScaledVector(port.dir, 0.25 * span),
      entry,
    ],
    false,
    "centripetal",
  );
  mesh.geometry?.dispose();
  mesh.geometry = new THREE.TubeGeometry(
    curve,
    HOSE_SEGMENTS,
    radius,
    12,
    false,
  );
  // Collar: centred between the port face and the hose end, along the axis.
  collar.position.copy(port.pos).addScaledVector(port.dir, collarLen / 2);
  collar.lookAt(collar.position.clone().add(port.dir));
  collar.scale.setScalar(radius);
}
