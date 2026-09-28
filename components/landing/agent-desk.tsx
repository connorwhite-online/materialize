"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";
import {
  PACKET_LAUNCH_S,
  PACKET_LOOP_S,
  PACKET_TRAVEL_S,
  agentClock,
} from "./agent-timeline";
import { platformPort } from "./holo-platform";
import {
  SPRITE_COLS,
  SPRITE_FRAMES,
  SPRITE_PALETTE,
  SPRITE_ROWS,
  TICKS_PER_SECOND,
  spriteFrameAt,
} from "./claude-sprite";

/**
 * The agents step: a little monitor, cabled into the printer platform's
 * hologram platform (holo-platform.tsx), with the Claude Code mascot on it as a
 * flat 8-bit sprite: the mascot's own typing animation, transcribed
 * frame-for-frame (claude-sprite.ts) and painted into a nearest-filtered
 * canvas texture over a frosted-glass screen.
 * Bulges swell down the cable as each piece of work is sent, easing into
 * the port, and the platform ripples as each lands (agentClock in
 * agent-timeline.ts).
 *
 * Authored in "agent units" (1 ≈ the monitor's height) and scaled by
 * frame.agentUnit, so desktop and phone share one model.
 */

// ─── Sprite ───────────────────────────────────────────────────────────

/** Canvas size in sprite pixels; one sprite cell is CELL pixels. */
const CELL = 1;
const SPRITE_W = SPRITE_COLS * CELL + 12;
const SPRITE_H = SPRITE_ROWS * CELL + 8;
/** Monitor, agent units. */
const SCREEN_W = 1.45;
const SCREEN_H = SCREEN_W * (SPRITE_H / SPRITE_W);
const BEZEL = 0.05;

/** Paint one frame of the transcribed animation (claude-sprite.ts). */
function drawSprite(ctx: CanvasRenderingContext2D, frame: number) {
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  const ox = (SPRITE_W - SPRITE_COLS * CELL) / 2;
  const oy = (SPRITE_H - SPRITE_ROWS * CELL) / 2;
  SPRITE_FRAMES[frame].forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const color = SPRITE_PALETTE[row[c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + c * CELL, oy + r * CELL, CELL, CELL);
    }
  });
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
    desk.rotation.y = f.orbitYaw ?? 0;
    setOpacity(desk, appear);
    if (collarRef.current) setOpacity(collarRef.current, appear);

    // ── Cable into the platform's front port (rebuilt when either end moves) ──
    const port = platformPort(f, portScratch);
    const key = `${(f.orbitYaw ?? 0).toFixed(3)},${f.desk.z.toFixed(3)},${f.desk.x.toFixed(3)},${f.desk.y.toFixed(3)},${port.pos.x.toFixed(3)},${port.pos.y.toFixed(3)},${u.toFixed(3)}`;
    if (key !== c.layoutKey) {
      c.layoutKey = key;
      layoutHose(hoseRef.current, collarRef.current, f, u, port);
    }

    // ── Sprite: the real animation's frames, on its own timing ──
    const shown = spriteFrameAt(t * TICKS_PER_SECOND);
    if (shown !== c.frame) {
      c.frame = shown;
      drawSprite(built.ctx, shown);
      markDirty(built.tex);
    }

    // ── Bulges down the cable, easing into the port ──
    const packets = hoseUniforms.uPackets.value;
    const amps = hoseUniforms.uAmps.value;
    let since = 10;
    // The sends repeat for as long as the step is up (they used to fire
    // once per arrival, then the cable went quiet).
    const tl = t % PACKET_LOOP_S;
    PACKET_LAUNCH_S.forEach((launch, i) => {
      const p = (tl - launch) / PACKET_TRAVEL_S;
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
      if (tl - launch - PACKET_TRAVEL_S >= 0)
        since = Math.min(since, tl - launch - PACKET_TRAVEL_S);
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
        <group
          rotation={MONITOR_ROT.toArray() as [number, number, number]}
          position={MONITOR_POS.toArray()}
        >
          {/* The cable's plug: a boss on the back, low on the right, with
              a tapered strain relief the cable leaves from. */}
          <group position={PLUG_LOCAL.toArray()}>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.012]}>
              <cylinderGeometry args={[0.075, 0.075, 0.03, 24]} />
              <meshStandardMaterial
                color="#1c1d21"
                metalness={0.6}
                roughness={0.35}
              />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.03]}>
              <cylinderGeometry args={[0.05, 0.06, 0.07, 24]} />
              <meshStandardMaterial
                color="#9ca0a7"
                metalness={1}
                roughness={0.3}
              />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.1]}>
              <cylinderGeometry args={[HOSE_RADIUS * 1.05, 0.045, 0.08, 20]} />
              <meshStandardMaterial color="#26272c" roughness={0.5} />
            </mesh>
          </group>
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

function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/** The monitor's pose inside the desk group, and its plug on the back. */
const MONITOR_POS = new THREE.Vector3(0, 0.5, 0);
const MONITOR_ROT = new THREE.Euler(-0.04, 0.32, 0);
const PLUG_LOCAL = new THREE.Vector3(0.48, -0.12, -0.05);
/** Where the cable leaves the strain relief, monitor space. */
const CABLE_START_LOCAL = new THREE.Vector3(0.48, -0.12, -0.19);

/**
 * Cable from the plug on the back of the monitor to the port on the
 * platform's rim: one cubic Bézier whose end tangents are the plug's
 * backward axis and the port's outward axis, so it leaves and enters
 * both straight, with a single smooth sag between (no Catmull-Rom
 * kinks). The collar sits on the port.
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
  const yaw = f.orbitYaw ?? 0;
  const up = new THREE.Vector3(0, 1, 0);
  const toWorld = (v: THREE.Vector3) =>
    v
      .clone()
      .applyEuler(MONITOR_ROT)
      .add(MONITOR_POS)
      .applyAxisAngle(up, yaw)
      .multiplyScalar(u)
      .add(f.desk);
  const start = toWorld(CABLE_START_LOCAL);
  const out = new THREE.Vector3(0, 0, -1)
    .applyEuler(MONITOR_ROT)
    .applyAxisAngle(up, yaw);
  const collarLen = radius * 2.6;
  const entry = port.pos.clone().addScaledVector(port.dir, collarLen);
  const span = start.distanceTo(entry);
  const curve = new THREE.CubicBezierCurve3(
    start,
    start
      .clone()
      .addScaledVector(out, span * 0.35)
      .add(new THREE.Vector3(0, -span * 0.25, 0)),
    entry
      .clone()
      .addScaledVector(port.dir, span * 0.4)
      .add(new THREE.Vector3(0, -span * 0.12, 0)),
    entry,
  );
  mesh.geometry?.dispose();
  mesh.geometry = new THREE.TubeGeometry(
    curve,
    HOSE_SEGMENTS,
    radius,
    14,
    false,
  );
  // Collar: centred between the port face and the hose end, along the axis.
  collar.position.copy(port.pos).addScaledVector(port.dir, collarLen / 2);
  collar.lookAt(collar.position.clone().add(port.dir));
  collar.scale.setScalar(radius);
}
