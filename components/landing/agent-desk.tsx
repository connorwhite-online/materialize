"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { MARK_PATH, MARK_VIEWBOX } from "@/components/brand/logo-paths";
import type { Frame } from "./choreography";
import { PACKET_LAUNCH_S, PACKET_TRAVEL_S } from "./agent-timeline";

/**
 * The agents step: the Claude Code mascot, built from voxels to match
 * its pixel sprite, jams on a little voxel laptop. A hose runs from the
 * laptop to the Materialize M; bulges swell along it as each piece of
 * work is sent, and the M flashes as each lands (agent-timeline.ts keeps
 * the checklist in the DOM ticking on the same beats).
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
const FOREARM = 4;

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
  uFade: { value: 0 },
};

function hoseMaterial(uniforms: {
  uPackets: { value: number[] };
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
      uniform float uFade;
      varying float vMzBulge;
      float mzBulge(float u) {
        float b = 0.0;
        for (int i = 0; i < ${MAX_PACKETS}; i++) {
          float d = (u - uPackets[i]) * 16.0;
          b = max(b, exp(-d * d));
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
         totalEmissiveRadiance += vec3(0.3, 0.58, 1.0) * vMzBulge * 1.6;`,
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.a *= uFade;",
      );
  };
  m.customProgramCacheKey = () => "mz-hose";
  return m;
}

// ─── Materialize M ───────────────────────────────────────────────────

function markGeometry(): THREE.ExtrudeGeometry {
  const [, , vw, vh] = MARK_VIEWBOX.split(/\s+/).map(Number);
  const svg = new SVGLoader().parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><path d="${MARK_PATH}"/></svg>`,
  );
  const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p));
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: vh * 0.28,
    // One-segment bevel = a flat 45° chamfer: each edge gets a crisp face
    // that catches a clean highlight line, like machined metal.
    bevelEnabled: true,
    bevelThickness: vh * 0.05,
    bevelSize: vh * 0.05,
    bevelSegments: 1,
    curveSegments: 10,
  });
  // SVG y points down. Flip it with a ROTATION, not scale(1, -1, 1): a
  // negative scale inverts the winding, turning the mesh inside out (it lit
  // dark navy from within). Then centre it and make it 1 unit wide.
  g.rotateX(Math.PI);
  g.scale(1 / vw, 1 / vw, 1 / vw);
  g.center();
  return g;
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
  const markRef = useRef<THREE.Mesh>(null);
  const screenLinesRef = useRef<THREE.Group>(null);
  const clock = useRef({ t: 0, onStep: false, layoutKey: "" });

  const built = useMemo(() => {
    const vox = mascotVoxels();
    return {
      vox,
      box: new THREE.BoxGeometry(V, V, V),
      hoseMat: hoseMaterial(hoseUniforms),
      markGeo: markGeometry(),
    };
  }, []);

  useFrame((_, delta) => {
    const f = frameRef.current;
    const root = rootRef.current;
    if (!f || !root) return;
    const w = f.agent;
    root.visible = w > 0.01;
    const c = clock.current;
    // The clock restarts on every arrival at the step (2), in step with
    // the DOM checklist, which keys off the same step change.
    const onStep = stepRef.current === 2;
    if (onStep && !c.onStep) c.t = 0;
    c.onStep = onStep;
    if (!root.visible) return;
    c.t += delta;

    const u = f.agentUnit;
    // ── Layout (rebuilt only when the viewport changes) ──
    const key = `${f.desk.x.toFixed(3)},${f.mark.x.toFixed(3)},${u.toFixed(3)}`;
    if (key !== c.layoutKey) {
      c.layoutKey = key;
      layoutHose(hoseRef.current, f, u);
    }
    // Everything eases in with the step weight: a small drop + scale.
    const appear = THREE.MathUtils.smoothstep(w, 0, 1);
    const desk = deskRef.current!;
    desk.position
      .copy(f.desk)
      .add(new THREE.Vector3(0, (1 - appear) * -0.2 * u, 0));
    desk.scale.setScalar(u * (0.85 + 0.15 * appear));

    // ── Mascot: jamming on the keys ──
    // Fast alternating taps, leaning into the screen with a little sway
    // and bob. Each time a bulge launches he hits Enter: both arms fly up,
    // he rocks back, then dives straight back in.
    const t = c.t;
    const mascot = mascotRef.current!;
    let enter = 0;
    for (const launch of PACKET_LAUNCH_S) {
      const k = (t - launch + 0.15) / 0.55; // starts just before the send
      if (k > 0 && k < 1) enter = Math.max(enter, Math.sin(Math.PI * k));
    }
    const typing = 1 - enter;
    mascot.rotation.x = 0.1 + Math.sin(t * 2.1) * 0.04 * typing - enter * 0.22;
    mascot.rotation.z = Math.sin(t * 1.3) * 0.05 * typing;
    mascot.position.y =
      Math.abs(Math.sin(t * 7)) * V * 0.25 * typing + enter * V * 0.8;
    // Arms: resting angle lays the forearm on the keys; taps lift & strike.
    const tap = (phase: number) => Math.max(0, Math.sin(t * 15 + phase));
    const rest = 0.95;
    armLRef.current!.rotation.x = rest - tap(0) * 0.28 * typing - enter * 2.1;
    armRRef.current!.rotation.x =
      rest - tap(Math.PI) * 0.28 * typing - enter * 2.1;
    const blink = t % 3.4 > 3.25 ? 0.1 : 1;
    eyesRef.current!.scale.y = blink;

    // Screen code lines scroll.
    const lines = screenLinesRef.current!;
    lines.children.forEach((line, i) => {
      const y = (i * 0.07 + t * 0.12) % 0.42;
      line.position.y = y;
      line.visible = y < 0.3;
    });

    // ── Packets down the hose ──
    const packets = hoseUniforms.uPackets.value;
    PACKET_LAUNCH_S.forEach((launch, i) => {
      const p = (t - launch) / PACKET_TRAVEL_S;
      packets[i] = p >= 0 && p <= 1.05 ? easeInOutSine(Math.min(p, 1)) : -1;
    });
    hoseUniforms.uFade.value = appear;

    // ── The M: breathes, flashes as each packet lands ──
    const mark = markRef.current!;
    mark.position.copy(f.mark);
    mark.scale.setScalar(u * 0.95 * (0.6 + 0.4 * appear));
    // Face turned up and toward the key softbox (upper-left, WarmStudio):
    // polished metal is only its reflections, and facing the dark studio
    // it rendered near-black.
    mark.rotation.y = -0.38 + Math.sin(t * 0.8) * 0.08; // negative = toward the key (left)
    mark.rotation.x = -0.28;
    let flash = 0;
    PACKET_LAUNCH_S.forEach((launch) => {
      const since = t - (launch + PACKET_TRAVEL_S);
      if (since > 0 && since < 0.9)
        flash = Math.max(flash, Math.exp(-since * 5));
    });
    const mm = mark.material as THREE.MeshPhysicalMaterial;
    // Blue only in the glint as a delivery lands; none at rest.
    mm.emissiveIntensity = flash * 1.8;
    mm.opacity = appear;
  });

  const { vox, box, hoseMat, markGeo } = built;
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
      <mesh ref={markRef} geometry={markGeo}>
        {/* Polished satin metal; each delivery glints it blue. */}
        <meshPhysicalMaterial
          // Just under fully metallic: a pure metal is ONLY its
          // reflections and picked up the studio's cool fill as blue. A
          // little diffuse keeps it reading neutral silver from any angle.
          color="#d6d8dc"
          metalness={0.82}
          roughness={0.3}
          clearcoat={0.5}
          clearcoatRoughness={0.15}
          emissive="#4f8dff"
          emissiveIntensity={0}
          envMapIntensity={1.8}
          transparent
        />
      </mesh>
    </group>
  );
}

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
      <meshStandardMaterial color={color} roughness={0.7} />
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
        <meshStandardMaterial
          color="#9ea2a8"
          roughness={0.35}
          metalness={0.7}
        />
      </mesh>
      {/* Keyboard: dark key rows on the deck, under his hands. */}
      {[-0.16, -0.06, 0.04].map((z) => (
        <mesh key={z} position={[0, 0.062, z]}>
          <boxGeometry args={[0.78, 0.008, 0.07]} />
          <meshStandardMaterial color="#26282d" roughness={0.6} />
        </mesh>
      ))}
      {/* Lid on the far hinge, leaning back away from him; short enough
          that his eyes clear it. Its back faces the camera. */}
      <group position={[0, 0.06, 0.28]} rotation={[0.28, 0, 0]}>
        <mesh position={[0, 0.23, 0]}>
          <boxGeometry args={[0.95, 0.46, 0.04]} />
          <meshStandardMaterial
            color="#9ea2a8"
            roughness={0.35}
            metalness={0.7}
          />
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
                  color={i % 3 === 0 ? "#7fb0ff" : "#d9774f"}
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
 * Hose from the laptop's side to the M, in world space: a lazy S that
 * dips between them. Rebuilt only when the layout changes.
 */
function layoutHose(mesh: THREE.Mesh | null, f: Frame, u: number) {
  if (!mesh) return;
  const start = f.desk
    .clone()
    .add(new THREE.Vector3(0.62 * u, 0.1 * u, 0.3 * u));
  const end = f.mark.clone().add(new THREE.Vector3(-0.42 * u, -0.1 * u, 0));
  const span = start.distanceTo(end);
  const curve = new THREE.CatmullRomCurve3(
    [
      start,
      start
        .clone()
        .add(new THREE.Vector3(0.18 * span, -0.2 * span, 0.1 * span)),
      end
        .clone()
        .add(new THREE.Vector3(-0.25 * span, -0.12 * span, 0.05 * span)),
      end,
    ],
    false,
    "centripetal",
  );
  mesh.geometry?.dispose();
  mesh.geometry = new THREE.TubeGeometry(
    curve,
    HOSE_SEGMENTS,
    HOSE_RADIUS * u,
    12,
    false,
  );
}
