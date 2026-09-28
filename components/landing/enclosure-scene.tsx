"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLanding } from "./landing-context";
import { AgentDesk } from "./agent-desk";
import { HoloPlatform } from "./holo-platform";
import {
  PLAIN,
  SWEEP_S,
  applyLook,
  endSweep,
  makeShellLayers,
  nextSweep,
  setSweepLine,
  startSweep,
  sweepEase,
  type ShellLayers,
} from "./burn-sweep";
import { LANDING_MATERIALS } from "./landing-materials";
import {
  PARTS,
  sampleFrame,
  mixFrames,
  orbitFrame,
  type Frame,
  type Geometry,
  type PartId,
} from "./choreography";

export const ENCLOSURE_URL = "/home/pneuma-q.glb";
/**
 * Detail internals (50%, ~1.3MB). The main file carries 12%
 * stand-ins so the hero can render at once; this one
 * streams in after the page is idle and replaces them in place, well
 * before anyone scrolls to the exploded view.
 */
const CREASE_ANGLE = Math.PI / 6;

export const DETAIL_URL = "/home/pneuma-q-detail.glb";

/**
 * Ambient occlusion baked in Blender (scripts/landing-glb/bake-ao.py),
 * laid out on the shells' own UVs. Colour-independent, so it survives
 * every material swap: creases, the seam and the camera bump keep their
 * soft contact shadow whatever the shell is made of.
 */
const AO_URLS = { front: "/home/ao-front.webp", rear: "/home/ao-rear.webp" };

type ShellId = "front" | "rear";

/**
 * Give a mesh its own transparent copy of the GLB's material (so the
 * internals can fade) — keeping the file's colour, metalness and
 * roughness rather than a generic stand-in.
 */
function fadeable(mesh: THREE.Mesh): THREE.Material {
  // Internals ship without normals (scripts/landing-glb/build.mjs drops
  // them so the CAD's split vertices can weld and simplify). Rebuild
  // them creased: hard edges stay crisp, fillets stay smooth.
  if (!mesh.geometry.getAttribute("normal")) {
    mesh.geometry = toCreasedNormals(mesh.geometry, CREASE_ANGLE);
  }
  const m = (mesh.material as THREE.Material).clone();
  m.transparent = true;
  mesh.material = m;
  return m;
}

/**
 * Swap a part's stand-in geometry for the detailed node. Both files
 * share model space, so the detail slots into the same recentring
 * wrapper with no offset of its own.
 */
function swapInDetail(part: LoadedPart, detail: THREE.Object3D) {
  const inner = detail.clone(true);
  const materials: THREE.Material[] = [];
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) materials.push(fadeable(mesh));
  });
  const opacity = part.materials[0]?.opacity ?? 0;
  for (const m of materials) m.opacity = opacity;
  part.object.clear();
  part.object.add(inner);
  part.materials.splice(0, part.materials.length, ...materials);
}

/** Loads the detail file and upgrades every internal part it covers. */
function DetailInternals({ parts }: { parts: Record<PartId, LoadedPart> }) {
  const { nodes } = useGLTF(DETAIL_URL);
  useEffect(() => {
    for (const spec of PARTS) {
      if (spec.shell) continue;
      const detail = nodes[spec.node];
      if (detail) swapInDetail(parts[spec.id], detail);
    }
  }, [nodes, parts]);
  return null;
}

/** True once the browser has had an idle moment after mount. */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const ric =
      window.requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => setIdle(true), { timeout: 3000 });
    return () => cancel(id);
  }, []);
  return idle;
}

interface LoadedPart {
  id: PartId;
  object: THREE.Object3D;
  center: THREE.Vector3;
  size: THREE.Vector3;
  materials: THREE.Material[];
}

/** Clone every part out of the GLB, centred on its own pivot. */
function useParts(ao: Record<ShellId, THREE.Texture>) {
  const { nodes } = useGLTF(ENCLOSURE_URL);
  return useMemo(() => {
    const parts = {} as Record<PartId, LoadedPart>;
    const layers = {} as Record<ShellId, ShellLayers>;
    const envelope = new THREE.Box3();
    for (const spec of PARTS) {
      const src = nodes[spec.node];
      if (!src) throw new Error(`pneuma-q.glb: missing node ${spec.node}`);
      // Keep the node's own transform: mesh quantization stores the
      // dequantizing scale/offset there. Recentre with a wrapper instead.
      const inner = src.clone(true);
      const object = new THREE.Group();
      object.add(inner);
      const materials: THREE.Material[] = [];
      let shellMesh: THREE.Mesh | null = null;
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (spec.shell) shellMesh = mesh;
        else materials.push(fadeable(mesh));
      });
      if (spec.shell && shellMesh) {
        // Built after the traverse: this adds sibling layers to the mesh.
        const l = makeShellLayers(shellMesh, ao[spec.id as ShellId]);
        applyLook(l.matA, LANDING_MATERIALS[PLAIN]);
        layers[spec.id as ShellId] = l;
      }
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      if (spec.shell) envelope.union(box);
      const center = box.getCenter(new THREE.Vector3());
      object.position.copy(center).negate();
      parts[spec.id] = {
        id: spec.id,
        object,
        center,
        size: box.getSize(new THREE.Vector3()),
        materials,
      };
    }
    const geo: Geometry = {
      centers: Object.fromEntries(
        PARTS.map((p) => [p.id, parts[p.id].center]),
      ) as Record<PartId, THREE.Vector3>,
      modelCenter: envelope.getCenter(new THREE.Vector3()),
    };
    return { parts, geo, layers };
  }, [nodes, ao]);
}

/**
 * Furthest a drag can turn the share/BOM scene, radians. A tug, not a
 * free orbit: the exploded stack already sits at 0.6 rad, and much past
 * ~1 rad it goes end-on and every part hides behind the front shell.
 */
const ORBIT_MAX = 0.4;

/** Seconds to travel one step. */
const STEP_TWEEN_S = 0.9;

// Per-frame mutation of three.js objects lives in these plain helpers:
// scene-graph objects are mutable by design, and the React compiler's
// immutability rule can't tell a material from React state.

function fadeMaterials(materials: THREE.Material[], opacity: number) {
  for (const m of materials) {
    m.opacity = opacity;
    m.depthWrite = opacity > 0.98;
  }
}

export function EnclosureScene({ reducedMotion }: { reducedMotion: boolean }) {
  const { orbitRef, step } = useLanding();
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const aoMaps = useTexture(AO_URLS, (t) => {
    for (const map of Array.isArray(t) ? t : [t]) prepareAo(map);
  });
  const { parts, geo, layers } = useParts(aoMaps);
  const viewport = useThree((s) => s.viewport);

  const deformRef = useRef<THREE.Group>(null);
  const pivots = useRef<Partial<Record<PartId, THREE.Group>>>({});
  const frameRef = useRef<Frame | null>(null);
  const smooth = useRef({
    progress: 0,
    orbit: 0,
    orbitV: 0,
    jump: null as { from: number; to: number; t: number } | null,
    clock: 0,
    // Burn sweep: the resting look, and the one sweeping in (-1 = none).
    look: PLAIN,
    to: -1,
    sweepT: 0,
    sinceSweep: 0,
    lineMin: 0,
    lineMax: 0,
    lastStep: 0,
  });

  const idle = useIdle();

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const st = smooth.current;
    st.clock += delta;
    const view = { w: viewport.width, h: viewport.height };
    // Adjacent steps walk the keyframe path at a steady pace, letting
    // sampleFrame's per-segment easing shape the motion. A jump that
    // would pass through another step (the tour wrapping BOM → hero)
    // crossfades straight from where we are to where we're going.
    const goal = stepRef.current;
    if (st.jump && st.jump.to !== goal) st.jump = null;
    if (!st.jump && Math.abs(goal - st.progress) > 1.01) {
      st.jump = { from: st.progress, to: goal, t: 0 };
    }
    let current: Frame;
    if (st.jump) {
      st.jump.t = Math.min(1, st.jump.t + delta / STEP_TWEEN_S);
      current = mixFrames(
        sampleFrame(st.jump.from, geo, view),
        sampleFrame(st.jump.to, geo, view),
        st.jump.t,
      );
      if (st.jump.t >= 1) {
        st.progress = st.jump.to;
        st.jump = null;
      }
    } else {
      const gap = goal - st.progress;
      st.progress +=
        Math.sign(gap) * Math.min(Math.abs(gap), delta / STEP_TWEEN_S);
      current = sampleFrame(st.progress, geo, view);
    }

    // Drag-orbit, the same on every step: a spring toward the finger's
    // pull (up to ORBIT_MAX), overshooting once when it's let go.
    st.orbitV +=
      ((orbitRef.current * ORBIT_MAX - st.orbit) * 90 - st.orbitV * 13) * delta;
    st.orbit += st.orbitV * delta;
    const yaw = st.orbit;
    const frame = Math.abs(yaw) > 1e-4 ? orbitFrame(current, yaw) : current;
    frameRef.current = frame;

    // Idle sway, gated to the hero. The group sits on the hero centre so
    // it turns around the device rather than around the screen.
    const deform = deformRef.current;
    if (deform) {
      deform.position.copy(frame.heroCenter);
      deform.rotation.y = reducedMotion
        ? 0
        : Math.sin(st.clock * 0.35) * 0.5 * frame.hero;
    }

    for (const spec of PARTS) {
      const g = pivots.current[spec.id];
      if (!g) continue;
      const pose = frame.poses[spec.id];
      g.position.copy(pose.position).sub(frame.heroCenter);
      g.quaternion.copy(pose.quaternion);
      g.scale.setScalar(pose.scale);
      g.visible = pose.opacity > 0.01;
      fadeMaterials(parts[spec.id].materials, pose.opacity);
    }

    runBurnSweep(st, layers, stepRef.current, delta, reducedMotion);
  });

  return (
    <>
      <group ref={deformRef}>
        {PARTS.map((spec) => (
          <group
            key={spec.id}
            ref={(g) => {
              if (g) pivots.current[spec.id] = g;
            }}
          >
            <primitive object={parts[spec.id].object} />
          </group>
        ))}
      </group>
      {idle && (
        <Suspense fallback={null}>
          <DetailInternals parts={parts} />
        </Suspense>
      )}
      <HoloPlatform frameRef={frameRef} />
      <AgentDesk frameRef={frameRef} stepRef={stepRef} />
      {PARTS.filter((p) => p.bom).map((spec) => (
        <BomLabel key={spec.id} id={spec.id} frameRef={frameRef} />
      ))}
    </>
  );
}

// ─── Burn sweep ───────────────────────────────────────────────────────

/** AO maps: glTF UV origin is top-left; data, not colour. */
function prepareAo(map: THREE.Texture) {
  map.flipY = false;
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
}

const shellBox = new THREE.Box3();

/**
 * Advance the burn sweep (see burn-sweep.ts). Starts one when the
 * schedule says so, climbs the line from the shells' current bottom to
 * top, flickers the band, and settles the new look when it arrives.
 */
function runBurnSweep(
  st: {
    clock: number;
    look: number;
    to: number;
    sweepT: number;
    sinceSweep: number;
    lineMin: number;
    lineMax: number;
    lastStep: number;
  },
  layers: Record<ShellId, ShellLayers>,
  step: number,
  delta: number,
  reducedMotion: boolean,
) {
  const shells = [layers.front, layers.rear];
  st.sinceSweep += delta;
  // Arriving back on the first step, give it a full cycle before the next
  // sweep — otherwise it fires while the shells are still flying home.
  if (step !== st.lastStep) {
    if (step === 0) st.sinceSweep = 0;
    st.lastStep = step;
  }
  if (st.to < 0) {
    const next = nextSweep(step, st.look, st.sinceSweep, false);
    // Reduced motion: no cycling on the hero; still settle to the plain
    // plastic off it, instantly.
    if (next === null || (reducedMotion && step === 0)) return;
    if (reducedMotion) {
      for (const l of shells) endSweep(l, next);
      st.look = next;
      return;
    }
    shellBox.makeEmpty();
    for (const l of shells) shellBox.expandByObject(l.a);
    // Clears the noisy edge's ±4.5% wander at both ends.
    const pad = (shellBox.max.y - shellBox.min.y) * 0.06;
    st.lineMin = shellBox.min.y - pad;
    st.lineMax = shellBox.max.y + pad;
    st.to = next;
    st.sweepT = 0;
    for (const l of shells) startSweep(l, next);
  }
  st.sweepT = Math.min(1, st.sweepT + delta / SWEEP_S);
  const h = THREE.MathUtils.lerp(st.lineMin, st.lineMax, sweepEase(st.sweepT));
  // Glow fades in off the bottom and out at the top; the shader supplies
  // the flicker and the noise.
  const glow = Math.pow(Math.sin(Math.PI * st.sweepT), 0.6);
  setSweepLine(h, st.lineMax - st.lineMin, st.clock, glow);
  if (st.sweepT >= 1) {
    for (const l of shells) endSweep(l, st.to);
    st.look = st.to;
    st.to = -1;
    st.sinceSweep = 0;
  }
}

// ─── Labels ───────────────────────────────────────────────────────────

/** Leader line from a part in the exploded view to its BOM label. */
function BomLabel({
  id,
  frameRef,
}: {
  id: PartId;
  frameRef: React.MutableRefObject<Frame | null>;
}) {
  const spec = PARTS.find((p) => p.id === id)!;
  const groupRef = useRef<THREE.Group>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<THREE.LineSegments>(null);
  const dot = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const f = frameRef.current;
    const g = groupRef.current;
    if (!f || !g || !spec.bom) return;
    const pose = f.poses[id];
    const { side, lane } = spec.bom;
    const y =
      side === "top"
        ? f.labelRows.top + lane * f.labelRows.lane
        : f.labelRows.bottom - lane * f.labelRows.lane;
    // The label holds its un-orbited place; only the leader's part end
    // follows the part as the scene is dragged round.
    const anchor = f.anchors?.[id] ?? pose.position;
    g.position.set(anchor.x, y, anchor.z);
    const visible = f.bomLabels > 0.01;
    const line = lineRef.current;
    if (line) {
      const pos = line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      pos.setXYZ(0, pose.position.x, pose.position.y, pose.position.z);
      pos.setXYZ(1, anchor.x, y + (side === "top" ? -0.06 : 0.06), anchor.z);
      pos.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = f.bomLabels * 0.5;
      line.visible = visible;
    }
    if (dot.current) {
      dot.current.position.copy(pose.position);
      dot.current.visible = visible;
      (dot.current.material as THREE.MeshBasicMaterial).opacity = f.bomLabels;
    }
    if (elRef.current) {
      elRef.current.style.opacity = String(f.bomLabels);
      elRef.current.style.display = f.bomLabels > 0.001 ? "" : "none";
    }
  });

  const lineColor = useLineColor();

  return (
    <>
      <lineSegments ref={lineRef} frustumCulled={false} renderOrder={10}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(6), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={lineColor}
          transparent
          depthTest={false}
          opacity={0}
        />
      </lineSegments>
      <mesh ref={dot} renderOrder={11}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color={lineColor} transparent depthTest={false} />
      </mesh>
      <group ref={groupRef}>
        <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div
            ref={elRef}
            style={{ opacity: 0 }}
            className="whitespace-nowrap rounded-full bg-card/80 px-2.5 py-1 text-[11px] leading-none text-foreground/90 ring-1 ring-foreground/10 backdrop-blur-md"
          >
            {spec.label}
          </div>
        </Html>
      </group>
    </>
  );
}

/** Leader ink follows the theme: dark lines on light, light on dark. */
function useLineColor(): string {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains("dark"));
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark ? "#e5e5e5" : "#222222";
}

useGLTF.preload(ENCLOSURE_URL);
useTexture.preload(Object.values(AO_URLS));
