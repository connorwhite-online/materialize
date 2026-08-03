"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import {
  STUDIO_CAMERA,
  STUDIO_TARGET_SIZE,
  frameSamples,
} from "./studio-frame";

/**
 * GPU point-cloud loader + morph renderer — the app's universal "3D is loading /
 * forming" placeholder. A dense cloud of points deforms (a malleable, forming
 * shape) and can morph between shapes: a sphere of points (fresh / generic) or
 * the surface points of an existing model (revision) → the generated shape's
 * surface points → crossfade to the crisp model.
 *
 * Hyper-performant by construction: ONE draw call, all motion in the vertex
 * shader (deform + morph via uniforms), nothing per-frame on the CPU. Points are
 * soft round sprites with distance attenuation. Reusable via `PointCloudScene`
 * (drop into any Canvas) — the studio wraps it in its own fixed-frame Canvas.
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uMorph;
  uniform float uFreq;
  uniform float uSize;
  uniform float uPixel;
  attribute vec3 aTarget;
  varying float vD;

  // Cheap layered-sine pseudo-noise — no texture, GPU-friendly.
  float n(vec3 p) {
    return sin(p.x * 2.0 + uTime)
         * sin(p.y * 2.0 + uTime * 1.2)
         * sin(p.z * 2.0 + uTime * 0.8);
  }

  void main() {
    float d = n(position * uFreq + uTime * 0.15);
    vD = d;
    vec3 dir = normalize(position + 1e-5);
    vec3 displaced = position + dir * d * uAmp;
    vec3 pos = mix(displaced, aTarget, uMorph);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective size attenuation (smaller with depth).
    gl_PointSize = uSize * uPixel * (1.0 / max(0.1, -mv.z));
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vD;
  void main() {
    // Soft round sprite: discard outside the disc, alpha falls off to the edge.
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float a = smoothstep(0.25, 0.02, r2) * clamp(0.6 + 0.35 * vD, 0.3, 0.95);
    gl_FragColor = vec4(uColor, a);
  }
`;

const BLOB_RADIUS = STUDIO_TARGET_SIZE * 0.34;
const POINT_COUNT = 20000; // dense cloud; one draw call so cost is trivial
const MORPH_DURATION = 1.2;
// Live (mid-generation) morphs are snappier than the final handoff morph.
const LIVE_MORPH_DURATION = 0.9;
// Wobble once the cloud has formed onto a live intermediate shape: enough to
// stay alive, small enough that the shape still reads.
const FORMED_IDLE_AMP = 0.05;
const FORMED_ACTIVE_AMP = 0.13;

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Stable ordering key around the sphere: latitude band, then longitude. */
function angleKey(x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z) || 1;
  return Math.asin(Math.max(-1, Math.min(1, y / r))) * 100 + Math.atan2(z, x);
}

/** Evenly-distributed points on a sphere (golden-angle spiral). */
function fibonacciSphere(count: number, radius: number): Float32Array {
  const pos = new Float32Array(count * 3);
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = phi * i;
    pos[i * 3] = Math.cos(t) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(t) * r * radius;
  }
  return pos;
}

/** A points geometry from a position buffer, with aTarget seeded to itself. */
function pointGeometry(pos: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aTarget", new THREE.BufferAttribute(pos.slice(), 3));
  return g;
}

/** Match arbitrary surface samples to the base points by angular position so
 *  the cloud flows coherently onto the shape. Handles fewer samples than base
 *  points (live snapshot payloads) by fanning each sample out to a run of
 *  neighbors with a little jitter so the cloud doesn't visibly clump. */
function matchTargets(
  basePos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  samples: THREE.Vector3[]
): Float32Array {
  const N = basePos.count;
  const S = samples.length;
  const baseOrder = [...Array(N).keys()].sort(
    (i, j) =>
      angleKey(basePos.getX(i), basePos.getY(i), basePos.getZ(i)) -
      angleKey(basePos.getX(j), basePos.getY(j), basePos.getZ(j))
  );
  const sampleOrder = [...Array(S).keys()].sort(
    (i, j) =>
      angleKey(samples[i].x, samples[i].y, samples[i].z) -
      angleKey(samples[j].x, samples[j].y, samples[j].z)
  );
  const jitter = S < N ? STUDIO_TARGET_SIZE * 0.012 : 0;
  const target = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    const s = samples[sampleOrder[Math.min(S - 1, Math.floor((k * S) / N))]];
    const b = baseOrder[k];
    target[b * 3] = s.x + (jitter ? (Math.random() - 0.5) * jitter : 0);
    target[b * 3 + 1] = s.y + (jitter ? (Math.random() - 0.5) * jitter : 0);
    target[b * 3 + 2] = s.z + (jitter ? (Math.random() - 0.5) * jitter : 0);
  }
  return target;
}

/** Morph targets: framed surface samples of the new model, matched to the base
 *  points by angular position so the cloud flows coherently onto the shape. */
function computePointTargets(
  basePos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  modelGeom: THREE.BufferGeometry
): Float32Array {
  return matchTargets(basePos, frameSamples(modelGeom, basePos.count));
}

/** Center + scale raw model-space points into the shared studio frame
 *  (mirrors studio-frame's fitMetrics, but for a bare point set). */
function frameLivePoints(points: Float32Array): THREE.Vector3[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (minX > maxX) return [];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const longest = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const scale = STUDIO_TARGET_SIZE / longest;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    out.push(
      new THREE.Vector3(
        (points[i] - cx) * scale,
        (points[i + 1] - cy) * scale,
        (points[i + 2] - cz) * scale
      )
    );
  }
  return out;
}

/** Bake the current morph state into `position` so a NEW morph can start from
 *  what's on screen instead of snapping back to the old base shape. */
function bakeMorph(geom: THREE.BufferGeometry, morph: number) {
  if (!(morph > 0)) return;
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const tgt = geom.attributes.aTarget as THREE.BufferAttribute | undefined;
  if (!tgt) return;
  const pa = pos.array as Float32Array;
  const ta = tgt.array as Float32Array;
  const m = Math.min(1, morph);
  for (let i = 0; i < pa.length; i++) pa[i] += (ta[i] - pa[i]) * m;
  pos.needsUpdate = true;
}

function PointCloud({
  baseGeom,
  active,
  idleAmp,
  activeAmp,
  freq,
  color = "#8aa0e8",
  morphUrl,
  livePoints,
  onMorphComplete,
}: {
  baseGeom: THREE.BufferGeometry;
  active: boolean;
  idleAmp: number;
  activeAmp: number;
  freq: number;
  color?: string;
  morphUrl?: string | null;
  /** Latest in-progress solid's surface points (raw model space) — the cloud
   *  morphs onto each one as snapshots land, instead of staying a blob. */
  livePoints?: Float32Array | null;
  onMorphComplete?: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const speed = useRef(0.6);
  const amp = useRef(idleAmp);
  const morphProgress = useRef(0);
  const morphing = useRef(false);
  const completed = useRef(false);
  // Whether the in-flight morph is the FINAL handoff (morphUrl) — only that
  // one freezes at the target and fires onMorphComplete. Live morphs bake +
  // resume wobbling instead.
  const isFinalMorph = useRef(false);
  // The cloud has formed onto a live intermediate shape — wobble gently so the
  // shape stays readable (mirrors the source-cloud amps).
  const formed = useRef(false);
  const morphDuration = useRef(MORPH_DURATION);
  const gl = useThree((s) => s.gl);
  const pixelRatio = gl.getPixelRatio();

  // Hold the completion callback in a ref so the morph effect below does NOT
  // depend on its identity (MTR-210). The studio passes an inline arrow that
  // is recreated on every parent render; if that identity were in the deps,
  // any re-render during the morph (a status event, setGenerating(false), the
  // reveal timer) would re-run the effect — resetting uMorph to 0 and reloading
  // the STL, i.e. the shape visibly "disappears/reloads right before the
  // transition." Keyed only on [morphUrl, baseGeom], the morph loads once and
  // runs uninterrupted.
  const onMorphCompleteRef = useRef(onMorphComplete);
  onMorphCompleteRef.current = onMorphComplete;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: idleAmp },
      uMorph: { value: 0 },
      uFreq: { value: freq },
      uSize: { value: 9.0 },
      uPixel: { value: pixelRatio },
      uColor: { value: new THREE.Color(color) },
    }),
    [idleAmp, freq, color, pixelRatio]
  );

  // Load the morph target, compute correspondence, run the morph. Fail-open:
  // any error completes immediately so the caller still proceeds. Deps are
  // ONLY [morphUrl, baseGeom] (see onMorphCompleteRef above) so a parent
  // re-render can't restart an in-flight morph.
  useEffect(() => {
    if (!morphUrl) return;
    let cancelled = false;
    morphing.current = false;
    completed.current = false;
    morphProgress.current = 0;
    // A live morph may be mid-flight — bake what's on screen into `position`
    // first so the final morph starts from the current shape, not a snap-back.
    if (matRef.current) {
      bakeMorph(baseGeom, matRef.current.uniforms.uMorph.value as number);
      matRef.current.uniforms.uMorph.value = 0;
    }
    const loader = new STLLoader();
    loader.load(
      morphUrl,
      (modelGeom) => {
        if (cancelled) {
          // Loader resolved after unmount/cancel — free the transient geometry
          // (STLLoader mints a fresh BufferGeometry per load) and bail.
          modelGeom.dispose();
          return;
        }
        try {
          const targets = computePointTargets(
            baseGeom.attributes.position,
            modelGeom
          );
          // Install the NEW morph target first, then free the GPU buffer of the
          // superseded one — dispose only AFTER the replacement is live (MTR-210
          // ordering; still no leaked buffer, MTR-168). The point cloud keeps
          // rendering from `position` (uMorph starts at 0), so this swap never
          // produces a blank/partial frame. `renderer.attributes` is an
          // internal (untyped) three surface; the narrow cast keeps the free a
          // no-op-safe best effort.
          const prevTarget = baseGeom.attributes.aTarget as
            | THREE.BufferAttribute
            | undefined;
          baseGeom.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
          const attrCache = (gl as unknown as {
            attributes?: { remove?: (a: THREE.BufferAttribute) => void };
          }).attributes;
          if (prevTarget) attrCache?.remove?.(prevTarget);
          morphProgress.current = 0;
          morphDuration.current = MORPH_DURATION;
          isFinalMorph.current = true;
          morphing.current = true;
        } catch {
          onMorphCompleteRef.current?.();
        } finally {
          // The morph-target mesh is only read for correspondence — never added
          // to the scene — so dispose it immediately either way.
          modelGeom.dispose();
        }
      },
      undefined,
      () => onMorphCompleteRef.current?.()
    );
    const safety = setTimeout(() => onMorphCompleteRef.current?.(), 8000);
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
    // onMorphComplete is intentionally excluded — it's read via a ref so a
    // changing callback identity never restarts the morph. `gl` is the
    // canvas-stable renderer, so including it never re-runs this.
  }, [morphUrl, baseGeom, gl]);

  // Live retarget: each in-progress snapshot's point set morphs the cloud onto
  // the actual solid taking shape. Chains freely — a newer target bakes the
  // current visual state and morphs on from there. The final handoff morph
  // (morphUrl) always wins: once it's set, live targets are ignored.
  useEffect(() => {
    if (!livePoints || livePoints.length < 9 || morphUrl) return;
    const samples = frameLivePoints(livePoints);
    if (samples.length === 0) return;
    if (matRef.current) {
      bakeMorph(baseGeom, matRef.current.uniforms.uMorph.value as number);
      matRef.current.uniforms.uMorph.value = 0;
    }
    const prevTarget = baseGeom.attributes.aTarget as
      | THREE.BufferAttribute
      | undefined;
    baseGeom.setAttribute(
      "aTarget",
      new THREE.BufferAttribute(
        matchTargets(baseGeom.attributes.position, samples),
        3
      )
    );
    const attrCache = (gl as unknown as {
      attributes?: { remove?: (a: THREE.BufferAttribute) => void };
    }).attributes;
    if (prevTarget) attrCache?.remove?.(prevTarget);
    morphProgress.current = 0;
    morphDuration.current = LIVE_MORPH_DURATION;
    isFinalMorph.current = false;
    morphing.current = true;
    formed.current = true;
  }, [livePoints, morphUrl, baseGeom, gl]);

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 2.5);
    speed.current += ((active ? 1.7 : 0.6) - speed.current) * k;
    // Once formed onto a live shape, wobble gently so the shape stays
    // readable; the abstract blob wobbles at full amplitude.
    const targetAmp = formed.current
      ? active
        ? Math.min(activeAmp, FORMED_ACTIVE_AMP)
        : Math.min(idleAmp, FORMED_IDLE_AMP)
      : active
        ? activeAmp
        : idleAmp;
    amp.current += (targetAmp - amp.current) * k;

    const m = matRef.current;
    if (m) {
      m.uniforms.uTime.value += delta * speed.current;
      m.uniforms.uAmp.value = amp.current;
      if (morphing.current) {
        morphProgress.current = Math.min(
          1,
          morphProgress.current + delta / morphDuration.current
        );
        m.uniforms.uMorph.value = smoothstep(morphProgress.current);
        if (morphProgress.current >= 1) {
          morphing.current = false;
          if (isFinalMorph.current) {
            // Final handoff: freeze at the target (pixel-registration with
            // the crisp model) and report completion exactly once.
            if (!completed.current) {
              completed.current = true;
              onMorphCompleteRef.current?.();
            }
          } else {
            // Live morph: bake the reached shape and resume wobbling from it
            // (uMorph=1 would otherwise pin the cloud dead-still).
            bakeMorph(baseGeom, 1);
            m.uniforms.uMorph.value = 0;
          }
        }
      }
    }
    if (pointsRef.current) {
      const rot = active ? 0.1 : 0.06;
      pointsRef.current.rotation.y += delta * rot;
      pointsRef.current.rotation.x += delta * rot * 0.3;
    }
  });

  return (
    <points ref={pointsRef} geometry={baseGeom}>
      <shaderMaterial
        ref={matRef}
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
      />
    </points>
  );
}

/**
 * Reusable point-cloud scene (NO Canvas) — drop into any Canvas as a "forming"
 * loader. With no sourceUrl it's a deforming sphere; with sourceUrl it forms
 * from an existing model's surface; morphUrl morphs it onto the generated shape.
 */
export function PointCloudScene({
  sourceUrl,
  active = true,
  morphUrl,
  livePoints,
  onMorphComplete,
}: {
  sourceUrl?: string | null;
  active?: boolean;
  morphUrl?: string | null;
  livePoints?: Float32Array | null;
  onMorphComplete?: () => void;
}) {
  const blob = useMemo(
    () => pointGeometry(fibonacciSphere(POINT_COUNT, BLOB_RADIUS)),
    []
  );
  // The sphere blob is created once for this scene's lifetime — dispose its GPU
  // buffers when the scene unmounts (MTR-168). Every studio revision remounts
  // this component via a key swap, so without this each turn strands a
  // 20k-point × 2-attribute geometry.
  useEffect(() => () => blob.dispose(), [blob]);

  const [loaded, setLoaded] = useState<{
    url: string;
    geom: THREE.BufferGeometry;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Dispose the previous source point-cloud geometry whenever it's superseded
  // (a new sourceUrl loads) and on unmount — it's owned here, not by r3f (the
  // <points geometry={...}> prop attaches an existing object, which r3f never
  // auto-disposes).
  useEffect(() => {
    const current = loaded?.geom;
    return () => {
      current?.dispose();
    };
  }, [loaded]);

  // Build a point cloud from the previous model's framed surface (revision).
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    new STLLoader().load(
      sourceUrl,
      (g) => {
        if (cancelled) {
          g.dispose();
          return;
        }
        const samples = frameSamples(g, POINT_COUNT);
        const pos = new Float32Array(POINT_COUNT * 3);
        for (let i = 0; i < POINT_COUNT; i++) {
          pos[i * 3] = samples[i].x;
          pos[i * 3 + 1] = samples[i].y;
          pos[i * 3 + 2] = samples[i].z;
        }
        // The loaded STL is only sampled for surface points — never rendered —
        // so free it now; `pointGeometry` copies what it needs.
        g.dispose();
        setLoaded({ url: sourceUrl, geom: pointGeometry(pos) });
      },
      undefined,
      () => {
        if (!cancelled) setFailedUrl(sourceUrl);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  const sourceGeom = sourceUrl && loaded?.url === sourceUrl ? loaded.geom : null;
  const isSource = !!sourceGeom;
  // Wait for the source surface to load before showing anything (revision);
  // fall back to the blob if it fails.
  const waiting = !!sourceUrl && !sourceGeom && failedUrl !== sourceUrl;

  return (
    <>
      <ambientLight intensity={0.7} />
      {!waiting && (
        <PointCloud
          key={isSource ? "src" : "blob"}
          baseGeom={sourceGeom ?? blob}
          active={active}
          // Surface clouds are already shaped — wobble gently; the blob is
          // abstract — wobble more, at a higher noise frequency for liveliness.
          idleAmp={isSource ? 0.05 : 0.18}
          activeAmp={isSource ? 0.14 : 0.32}
          freq={isSource ? 1.6 : 2.1}
          morphUrl={morphUrl}
          livePoints={livePoints}
          onMorphComplete={onMorphComplete}
        />
      )}
    </>
  );
}

/** Studio loader — the point-cloud scene in its own fixed-frame Canvas so it
 *  registers pixel-for-pixel with <ModelViewer fixedFrame>. */
export function MaterializingBlob({
  className,
  active = false,
  sourceUrl,
  morphUrl,
  livePoints,
  onMorphComplete,
}: {
  className?: string;
  active?: boolean;
  sourceUrl?: string | null;
  morphUrl?: string | null;
  /** Latest snapshot's surface points (decodeSnapshotPoints) — morphs the
   *  forming cloud onto each in-progress solid as generation advances. */
  livePoints?: Float32Array | null;
  onMorphComplete?: () => void;
}) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: STUDIO_CAMERA.position, fov: STUDIO_CAMERA.fov }}
        dpr={[1, 2]}
      >
        <PointCloudScene
          sourceUrl={sourceUrl}
          active={active}
          morphUrl={morphUrl}
          livePoints={livePoints}
          onMorphComplete={onMorphComplete}
        />
      </Canvas>
    </div>
  );
}
