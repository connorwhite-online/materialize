"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Download } from "@/components/icons/download";
import { useLanding } from "./landing-context";
import { buildStandIn, hasStandIn } from "./stand-ins";
import { LANDING_MATERIALS } from "./landing-materials";
import {
  PARTS,
  sampleFrame,
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
      if (spec.shell || hasStandIn(spec.id)) continue;
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
function useParts(shellMaterial: THREE.MeshPhysicalMaterial) {
  const { nodes } = useGLTF(ENCLOSURE_URL);
  return useMemo(() => {
    const parts = {} as Record<PartId, LoadedPart>;
    const envelope = new THREE.Box3();
    for (const spec of PARTS) {
      const src = nodes[spec.node];
      if (!src) throw new Error(`pneuma-q.glb: missing node ${spec.node}`);
      // Keep the node's own transform: mesh quantization stores the
      // dequantizing scale/offset there. Recentre with a wrapper instead.
      // Envelope-only CAD parts get a modelled stand-in (stand-ins.ts).
      const inner = buildStandIn(spec.id, src) ?? src.clone(true);
      const object = new THREE.Group();
      object.add(inner);
      const materials: THREE.Material[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (spec.shell) {
          mesh.material = shellMaterial;
          return;
        }
        materials.push(fadeable(mesh));
      });
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
    return { parts, geo };
  }, [nodes, shellMaterial]);
}

const SHELL_IDS = ["front", "rear"] as const;

// Per-frame mutation of three.js objects lives in these plain helpers:
// scene-graph objects are mutable by design, and the React compiler's
// immutability rule can't tell a material from React state.

function fadeMaterials(materials: THREE.Material[], opacity: number) {
  for (const m of materials) {
    m.opacity = opacity;
    m.depthWrite = opacity > 0.98;
  }
}

/** Ease the shared shell material toward a family's look (~600ms). */
function lerpShell(
  m: THREE.MeshPhysicalMaterial,
  target: (typeof LANDING_MATERIALS)[number],
  color: THREE.Color,
  k: number,
) {
  const lerp = THREE.MathUtils.lerp;
  m.color.lerp(color, k);
  m.metalness = lerp(m.metalness, target.metalness, k);
  m.roughness = lerp(m.roughness, target.roughness, k);
  m.clearcoat = lerp(m.clearcoat, target.clearcoat ?? 0, k);
  m.transmission = lerp(m.transmission, target.transmission ?? 0, k);
  m.ior = lerp(m.ior, target.ior ?? 1.5, k);
  m.thickness = lerp(m.thickness, target.thickness ?? 0, k);
}

export function EnclosureScene({ reducedMotion }: { reducedMotion: boolean }) {
  const { material, burst, tensionRef, progressRef, setReady } = useLanding();
  const shellMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: LANDING_MATERIALS[0].color,
        roughness: LANDING_MATERIALS[0].roughness,
        metalness: LANDING_MATERIALS[0].metalness,
        clearcoatRoughness: 0.12,
      }),
    [],
  );
  const { parts, geo } = useParts(shellMaterial);
  const viewport = useThree((s) => s.viewport);

  const deformRef = useRef<THREE.Group>(null);
  const pivots = useRef<Partial<Record<PartId, THREE.Group>>>({});
  const frameRef = useRef<Frame | null>(null);
  const smooth = useRef({
    progress: 0,
    sway: 0,
    swayV: 0,
    tilt: 0,
    tiltV: 0,
    clock: 0,
  });

  useEffect(() => setReady(true), [setReady]);
  const idle = useIdle();

  const target = LANDING_MATERIALS[material];
  const targetColor = useMemo(() => new THREE.Color(target.color), [target]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const st = smooth.current;
    st.clock += delta;
    st.progress +=
      (progressRef.current - st.progress) * (1 - Math.exp(-delta * 9));

    const frame = sampleFrame(st.progress, geo, {
      w: viewport.width,
      h: viewport.height,
    });
    frameRef.current = frame;

    // Swipe deformation + idle sway, both gated to the hero. The deform
    // group sits on the hero centre so the stretch pulls around the
    // device rather than around the screen.
    const deform = deformRef.current;
    if (deform) {
      const h = frame.hero;
      const tension = tensionRef.current * h;
      const a = Math.abs(tension);
      const k = 1 - Math.exp(-delta * 28);
      deform.scale.x += (1 + a * 0.22 - deform.scale.x) * k;
      deform.scale.y += (1 - a * 0.12 - deform.scale.y) * k;
      deform.scale.z += (1 - a * 0.06 - deform.scale.z) * k;
      // Damped springs so a release overshoots once and settles.
      st.swayV += ((tension * 0.4 - st.sway) * 700 - st.swayV * 26) * delta;
      st.sway += st.swayV * delta;
      st.tiltV += ((tension * 0.12 - st.tilt) * 700 - st.tiltV * 26) * delta;
      st.tilt += st.tiltV * delta;
      deform.position.copy(frame.heroCenter);
      deform.position.x += st.sway;
      deform.rotation.z = st.tilt;
      deform.rotation.y = reducedMotion
        ? 0
        : Math.sin(st.clock * 0.35) * 0.5 * h;
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

    lerpShell(shellMaterial, target, targetColor, 1 - Math.exp(-delta * 4));
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
      <ShedParticles
        burst={burst}
        shed={LANDING_MATERIALS[burst.from]}
        sources={SHELL_IDS.map((id) => parts[id].object)}
        frameRef={frameRef}
      />
      {SHELL_IDS.map((id) => (
        <FileLabel key={id} id={id} size={parts[id].size} frameRef={frameRef} />
      ))}
      {PARTS.filter((p) => p.bom).map((spec) => (
        <BomLabel key={spec.id} id={spec.id} frameRef={frameRef} />
      ))}
    </>
  );
}

// ─── Particle shed ────────────────────────────────────────────────────

const MAX_PARTICLES = 700;
const MIN_PARTICLES = 60;
const LIFETIME = 0.55;

type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  scale: number;
};
type Sample = { mesh: THREE.Mesh; p: THREE.Vector3 };

/** Shed particles off the shell surfaces, flung along the swipe. */
function spawnBurst(
  particles: Particle[],
  samples: Sample[][],
  burst: { direction: number; intensity: number },
  heroCenter: THREE.Vector3 | undefined,
) {
  const n = Math.min(1, burst.intensity / 1.5);
  const count = Math.round(
    MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * Math.sqrt(n),
  );
  const push = 0.8 + burst.intensity * 1.05;
  const centre = heroCenter ?? new THREE.Vector3();
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (i >= count) {
      p.age = LIFETIME + 1;
      continue;
    }
    const set = samples[i % samples.length];
    const s = set[(Math.random() * set.length) | 0];
    if (!s) continue;
    p.position.copy(s.p).applyMatrix4(s.mesh.matrixWorld);
    const out = p.position.clone().sub(centre).normalize();
    const speed = 0.75 + Math.random() * 0.7;
    p.velocity.set(
      out.x * speed +
        burst.direction * push * (0.5 + Math.random() * Math.random()),
      out.y * speed * 0.6 + (Math.random() - 0.5) * 0.8,
      out.z * speed * 0.4,
    );
    p.age = 0;
    p.scale = 0.005 + Math.random() * 0.011;
    p.rotation.set(
      Math.random() * 6.3,
      Math.random() * 6.3,
      Math.random() * 6.3,
    );
    p.spin.set(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
    );
  }
}

function stepParticles(
  particles: Particle[],
  mesh: THREE.InstancedMesh,
  dummy: THREE.Object3D,
  delta: number,
) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (p.age >= LIFETIME) {
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      continue;
    }
    p.age += delta;
    p.position.addScaledVector(p.velocity, delta);
    p.velocity.multiplyScalar(0.968);
    p.rotation.addScaledVector(p.spin, delta);
    const life = p.age / LIFETIME;
    const fade = life < 0.4 ? 1 : 1 - Math.pow((life - 0.4) / 0.6, 1.4);
    dummy.position.copy(p.position);
    dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
    dummy.scale.setScalar(p.scale * Math.max(0, fade));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
}

function ShedParticles({
  burst,
  shed,
  sources,
  frameRef,
}: {
  burst: { key: number; direction: number; intensity: number };
  shed: (typeof LANDING_MATERIALS)[number];
  sources: THREE.Object3D[];
  frameRef: React.MutableRefObject<Frame | null>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        age: LIFETIME + 1,
        scale: 0,
      })),
    [],
  );
  // Surface samples: vertices of each shell, in the shell's own space.
  const samples = useMemo(
    () =>
      sources.map((obj) => {
        const pts: { mesh: THREE.Mesh; p: THREE.Vector3 }[] = [];
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const pos = mesh.geometry.getAttribute("position");
          const step = Math.max(1, Math.floor(pos.count / 400));
          for (let i = 0; i < pos.count; i += step) {
            pts.push({
              mesh,
              p: new THREE.Vector3().fromBufferAttribute(pos, i),
            });
          }
        });
        return pts;
      }),
    [sources],
  );

  useEffect(() => {
    if (burst.key === 0) return;
    const hero = frameRef.current?.hero ?? 1;
    if (hero < 0.3) return;
    spawnBurst(particles, samples, burst, frameRef.current?.heroCenter);
  }, [burst, particles, samples, frameRef]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    stepParticles(particles, mesh, dummy, delta);
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_PARTICLES]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      {/* The shell sheds its OUTGOING skin: particles wear the material
          being swiped away while the surface lerps to the new one. */}
      <meshStandardMaterial
        color={shed.color}
        metalness={shed.metalness}
        roughness={Math.max(0.2, shed.roughness)}
      />
    </instancedMesh>
  );
}

// ─── Labels ───────────────────────────────────────────────────────────

const FILES: Record<"front" | "rear", { name: string; size: string }> = {
  front: { name: "02_Front_soft_shell.step", size: "6.4 MB" },
  rear: { name: "01_Rear_soft_shell.step", size: "5.8 MB" },
};

/** File-name chip under each split shell, with a download facade. */
function FileLabel({
  id,
  size,
  frameRef,
}: {
  id: "front" | "rear";
  size: THREE.Vector3;
  frameRef: React.MutableRefObject<Frame | null>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);

  useFrame(() => {
    const f = frameRef.current;
    const g = groupRef.current;
    if (!f || !g) return;
    const pose = f.poses[id];
    // The shell stands on its long axis (model Z) in the split pose.
    g.position.copy(pose.position);
    g.position.y -= (size.z * pose.scale) / 2 + 0.12;
    if (elRef.current) {
      elRef.current.style.opacity = String(f.fileLabels);
      elRef.current.style.pointerEvents = f.fileLabels > 0.6 ? "auto" : "none";
    }
  });

  const file = FILES[id];
  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[5, 0]}>
        <div
          ref={elRef}
          style={{ opacity: 0 }}
          className="flex max-w-[46vw] items-center gap-2 whitespace-nowrap rounded-full bg-card/80 py-1 pl-3 pr-1 text-[11px] sm:max-w-none sm:text-xs ring-1 ring-foreground/10 backdrop-blur-md"
        >
          <span className="min-w-0 truncate font-mono text-foreground/90">
            {file.name}
          </span>
          <span className="hidden text-muted-foreground sm:inline">
            {file.size}
          </span>
          <button
            type="button"
            aria-label={`Download ${file.name}`}
            onClick={() => {
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1400);
            }}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 active:scale-90"
          >
            {saved ? (
              <span className="text-[10px]">✓</span>
            ) : (
              <Download size={12} />
            )}
          </button>
        </div>
      </Html>
    </group>
  );
}

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
    g.position.set(pose.position.x, y, pose.position.z);
    const visible = f.bomLabels > 0.01;
    const line = lineRef.current;
    if (line) {
      const pos = line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      pos.setXYZ(0, pose.position.x, pose.position.y, pose.position.z);
      pos.setXYZ(
        1,
        pose.position.x,
        y + (side === "top" ? -0.06 : 0.06),
        pose.position.z,
      );
      pos.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = f.bomLabels * 0.5;
      line.visible = visible;
    }
    if (dot.current) {
      dot.current.position.copy(pose.position);
      dot.current.visible = visible;
      (dot.current.material as THREE.MeshBasicMaterial).opacity = f.bomLabels;
    }
    if (elRef.current) elRef.current.style.opacity = String(f.bomLabels);
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
