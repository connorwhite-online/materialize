"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";
import { PACKET_LAUNCH_S, PACKET_TRAVEL_S, agentClock } from "./agent-timeline";
import { platformPort } from "./holo-platform";

/**
 * The agents step: a little monitor, cabled into the printer platform's
 * front port (holo-platform.tsx), with the Claude Code mascot on it as a
 * flat 8-bit sprite hammering a pixel keyboard. The sprite is drawn into a
 * canvas texture — nearest-filtered, and stepped at SPRITE_FPS so it
 * animates like a sprite, not a tween — over a frosted-glass screen.
 * Bulges swell down the cable as each piece of work is sent, easing into
 * the port, and the platform ripples as each lands (agentClock in
 * agent-timeline.ts).
 *
 * Authored in "agent units" (1 ≈ the monitor's height) and scaled by
 * frame.agentUnit, so desktop and phone share one model.
 */

// ─── Sprite ───────────────────────────────────────────────────────────

/**
 * After the Claude Code mascot's own animation: turned three-quarters to
 * his right (the darker column is his side), tapping a tiny grey laptop
 * drawn in profile — a flat base and a lid leaning back. Between bursts
 * he turns to face you, arm stubs out. Grids are top row first:
 * B body, D side (shade), E eye, A arm, L leg.
 */
const TYPING = [
  ".DBBBBBBB.",
  ".DBEBBBEB.",
  ".DBBBBBBBA",
  ".DBBBBBBB.",
  ".L.L..L.L.",
];
/** Same, arm down on the keys (the hand drawn separately, half a cell). */
const TYPING_DOWN = [
  ".DBBBBBBB.",
  ".DBEBBBEB.",
  ".DBBBBBBB.",
  ".DBBBBBBBA",
  ".L.L..L.L.",
];
const FRONT = [
  ".BBBBBBBB.",
  ".BEBBBBEB.",
  "ABBBBBBBBA",
  ".BBBBBBBB.",
  ".L.L..L.L.",
];
const ORANGE = "#d97757";
const SIDE = "#b65f43";
const EYE = "#1a1a1a";
const LAPTOP = "#8b8b8e";
/** Canvas size in sprite pixels; one grid cell is CELL pixels. */
const SPRITE_W = 64;
const SPRITE_H = 36;
const CELL = 4;
const SPRITE_FPS = 12;
/** Monitor, agent units. */
const SCREEN_W = 1.45;
const SCREEN_H = SCREEN_W * (SPRITE_H / SPRITE_W);
const BEZEL = 0.05;

interface SpritePose {
  /** Facing you (idle between bursts, and on Enter). */
  front: boolean;
  /** Hand down on the keys. */
  down: boolean;
  /** Hop (Enter). */
  hop: boolean;
  blink: boolean;
}

function drawSprite(ctx: CanvasRenderingContext2D, pose: SpritePose) {
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  const grid = pose.front ? FRONT : pose.down ? TYPING_DOWN : TYPING;
  // Sprite + laptop span ~13 cells; centre that on the screen.
  const ox = (SPRITE_W - 13 * CELL) / 2;
  const floor = (SPRITE_H + grid.length * CELL) / 2; // bottom of the legs
  const oy = floor - grid.length * CELL - (pose.hop ? CELL : 0);
  grid.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === ".") return;
      ctx.fillStyle =
        ch === "D" ? SIDE : ch === "E" && !pose.blink ? EYE : ORANGE;
      ctx.fillRect(ox + c * CELL, oy + r * CELL, CELL, CELL);
    });
  });
  const half = CELL / 2;
  if (!pose.front && pose.down) {
    // The hand reaching the keys, half a cell past the arm.
    ctx.fillStyle = ORANGE;
    ctx.fillRect(ox + 10 * CELL, oy + 3 * CELL + half, half, half);
  }
  // Laptop in profile, a half-cell line: base along the floor, lid
  // leaning back from its far end.
  ctx.fillStyle = LAPTOP;
  const bx = ox + 10 * CELL;
  ctx.fillRect(bx, floor - half, 1.5 * CELL, half);
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(
      bx + 1.5 * CELL + i * half,
      floor - half - (i + 1) * half,
      half,
      half,
    );
  }
}

/** Rounded-rectangle frame (outer minus inner), extruded thin. */
function bezelGeometry(): THREE.ExtrudeGeometry {
  const trace = (p: THREE.Path, w: number, h: number, r: number) => {
    const x = -w / 2;
    const y = -h / 2;
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
    return p;
  };
  const outer = trace(
    new THREE.Shape(),
    SCREEN_W + BEZEL * 2,
    SCREEN_H + BEZEL * 2,
    0.09,
  ) as THREE.Shape;
  outer.holes.push(trace(new THREE.Path(), SCREEN_W, SCREEN_H, 0.05));
  const g = new THREE.ExtrudeGeometry(outer, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -0.03);
  return g;
}

// ─── Hose ─────────────────────────────────────────────────────────────

const HOSE_SEGMENTS = 120;
const HOSE_RADIUS = 0.035;
const MAX_PACKETS = PACKET_LAUNCH_S.length;
/** Module-level like the burn-sweep uniforms: one hose, mutated per frame. */
const hoseUniforms = {
  uPackets: { value: new Array<number>(PACKET_LAUNCH_S.length).fill(-1) },
  // Per-bulge size: swells leaving the monitor, squeezes down into the port.
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
         transformed += normal * vMzBulge * ${(HOSE_RADIUS * 0.75).toFixed(4)};`,
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
  const hoseRef = useRef<THREE.Mesh>(null);
  const collarRef = useRef<THREE.Group>(null);
  const clock = useRef({
    t: 0,
    onStep: false,
    layoutKey: "",
    fade: 0,
    frame: -1,
  });

  const built = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_W;
    canvas.height = SPRITE_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return {
      ctx: canvas.getContext("2d")!,
      tex,
      bezel: bezelGeometry(),
      hoseMat: hoseMaterial(hoseUniforms),
    };
  }, []);

  useFrame((_, rawDelta) => {
    const f = frameRef.current;
    const root = rootRef.current;
    if (!f || !root) return;
    const delta = Math.min(rawDelta, 1 / 20);
    const w = f.agent;
    const c = clock.current;
    root.visible = w > 0.01 && (stepRef.current === 2 || c.fade > 0);
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
    // Arriving, it fades in with the transition. Leaving, it fades out on
    // its own clock (~150ms) the moment the step changes, BEFORE the
    // scene moves.
    c.fade = onStep
      ? Math.max(c.fade, THREE.MathUtils.smoothstep(w, 0.4, 1))
      : Math.max(0, c.fade - delta * 7);
    const appear = c.fade;

    const desk = deskRef.current!;
    desk.position.copy(f.desk);
    desk.scale.setScalar(u);
    setOpacity(desk, appear);
    if (collarRef.current) setOpacity(collarRef.current, appear);

    // ── Cable into the platform's front port (rebuilt when either end moves) ──
    const port = platformPort(f, portScratch);
    const key = `${f.desk.x.toFixed(3)},${f.desk.y.toFixed(3)},${port.pos.x.toFixed(3)},${port.pos.y.toFixed(3)},${u.toFixed(3)}`;
    if (key !== c.layoutKey) {
      c.layoutKey = key;
      layoutHose(hoseRef.current, collarRef.current, f, u, port);
    }

    // ── Sprite: stepped, like the real thing ──
    const n = Math.floor(t * SPRITE_FPS);
    if (n !== c.frame) {
      c.frame = n;
      let enter = false;
      for (const launch of PACKET_LAUNCH_S) {
        const d = t - launch;
        if (d > -0.25 && d < 0.3) enter = true;
      }
      // Bursts of tapping, now and then turning to face you between them.
      // Within a burst the hand hits every other frame, skipping beats
      // irregularly so it never reads as a loop.
      const burst = noise1(t * 0.45 + 11) > 0.3;
      const down = burst && !enter && n % 2 === 0 && hash(n) > 0.18;
      drawSprite(built.ctx, {
        front: enter || !burst,
        down,
        hop: enter && n % 4 < 2,
        blink: blink(t),
      });
      markDirty(built.tex);
    }

    // ── Bulges down the cable, easing into the port ──
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
        // Swell out of the monitor, squeeze down to nothing entering the
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

  const { tex, bezel, hoseMat } = built;
  return (
    <group ref={rootRef}>
      <group ref={deskRef}>
        {/* Turned a little toward the platform it's plugged into. */}
        <group rotation={[-0.04, 0.32, 0]} position={[0, 0.5, 0]}>
          {/* Frosted glass behind the sprite: the scene blurs through. */}
          <mesh position={[0, 0, -0.012]}>
            <planeGeometry args={[SCREEN_W, SCREEN_H]} />
            <meshPhysicalMaterial
              color="#1f1c1a"
              transmission={0.35}
              roughness={0.6}
              thickness={0.2}
              ior={1.3}
              transparent
              userData={{ baseOpacity: 0.92 }}
            />
          </mesh>
          <mesh>
            <planeGeometry args={[SCREEN_W * 0.94, SCREEN_H * 0.94]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} />
          </mesh>
          {/* A subtle frame. */}
          <mesh geometry={bezel}>
            <meshStandardMaterial
              color="#1c1d21"
              metalness={0.6}
              roughness={0.35}
            />
          </mesh>
        </group>
      </group>
      <mesh ref={hoseRef} material={hoseMat} frustumCulled={false} />
      {/* Where the cable meets the port: a short metal collar. */}
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

/** Fade every material under `group` (screen, frame, collar). */
function setOpacity(group: THREE.Object3D, o: number) {
  group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | undefined;
    if (!m) return;
    m.transparent = true;
    m.opacity = o * ((m.userData.baseOpacity as number | undefined) ?? 1);
    m.depthWrite = o > 0.5;
  });
}

const portScratch = { pos: new THREE.Vector3(), dir: new THREE.Vector3() };

/** Re-upload a canvas texture (a module helper, for the compiler lint). */
function markDirty(tex: THREE.Texture) {
  tex.needsUpdate = true;
}

/** Deterministic per-frame randomness in [0, 1). */
function hash(n: number): number {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [0, 1]. */
function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const k = f * f * (3 - 2 * f);
  return hash(i) * (1 - k) + hash(i + 1) * k;
}

/** Blinks for a frame or two at irregular intervals (~2.5–5s apart). */
function blink(t: number): boolean {
  const cycle = 3.4 + (noise1(Math.floor(t / 3.4) * 1.7) - 0.5) * 1.8;
  return t % cycle > cycle - 0.14;
}

function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/**
 * Cable from the back of the monitor, sagging down and across into the
 * port on the platform's front rim, arriving straight on (along the
 * port's outward axis) so it reads as plugged in. The collar sits on the
 * port.
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
  // Out of the back of the monitor, low on its right-hand side.
  const start = f.desk
    .clone()
    .add(new THREE.Vector3(0.5 * u, 0.12 * u, -0.08 * u));
  const collarLen = radius * 2.6;
  const entry = port.pos.clone().addScaledVector(port.dir, collarLen);
  const span = start.distanceTo(entry);
  const curve = new THREE.CatmullRomCurve3(
    [
      start,
      // Down in a lazy sag…
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
