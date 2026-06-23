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

/** Morph targets: framed surface samples of the new model, matched to the base
 *  points by angular position so the cloud flows coherently onto the shape. */
function computePointTargets(
  basePos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  modelGeom: THREE.BufferGeometry
): Float32Array {
  const N = basePos.count;
  const samples = frameSamples(modelGeom, N);
  const baseOrder = [...Array(N).keys()].sort(
    (i, j) =>
      angleKey(basePos.getX(i), basePos.getY(i), basePos.getZ(i)) -
      angleKey(basePos.getX(j), basePos.getY(j), basePos.getZ(j))
  );
  const sampleOrder = [...Array(N).keys()].sort(
    (i, j) =>
      angleKey(samples[i].x, samples[i].y, samples[i].z) -
      angleKey(samples[j].x, samples[j].y, samples[j].z)
  );
  const target = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    const s = samples[sampleOrder[k]];
    const b = baseOrder[k];
    target[b * 3] = s.x;
    target[b * 3 + 1] = s.y;
    target[b * 3 + 2] = s.z;
  }
  return target;
}

function PointCloud({
  baseGeom,
  active,
  idleAmp,
  activeAmp,
  freq,
  color = "#8aa0e8",
  morphUrl,
  onMorphComplete,
}: {
  baseGeom: THREE.BufferGeometry;
  active: boolean;
  idleAmp: number;
  activeAmp: number;
  freq: number;
  color?: string;
  morphUrl?: string | null;
  onMorphComplete?: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const speed = useRef(0.6);
  const amp = useRef(idleAmp);
  const morphProgress = useRef(0);
  const morphing = useRef(false);
  const completed = useRef(false);
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());

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
  // any error completes immediately so the caller still proceeds.
  useEffect(() => {
    if (!morphUrl) return;
    let cancelled = false;
    morphing.current = false;
    completed.current = false;
    morphProgress.current = 0;
    if (matRef.current) matRef.current.uniforms.uMorph.value = 0;
    const loader = new STLLoader();
    loader.load(
      morphUrl,
      (modelGeom) => {
        if (cancelled) return;
        try {
          const targets = computePointTargets(
            baseGeom.attributes.position,
            modelGeom
          );
          baseGeom.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
          morphProgress.current = 0;
          morphing.current = true;
        } catch {
          onMorphComplete?.();
        }
      },
      undefined,
      () => onMorphComplete?.()
    );
    const safety = setTimeout(() => onMorphComplete?.(), 8000);
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, [morphUrl, baseGeom, onMorphComplete]);

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 2.5);
    speed.current += ((active ? 1.7 : 0.6) - speed.current) * k;
    amp.current += ((active ? activeAmp : idleAmp) - amp.current) * k;

    const m = matRef.current;
    if (m) {
      m.uniforms.uTime.value += delta * speed.current;
      m.uniforms.uAmp.value = amp.current;
      if (morphing.current) {
        morphProgress.current = Math.min(
          1,
          morphProgress.current + delta / MORPH_DURATION
        );
        m.uniforms.uMorph.value = smoothstep(morphProgress.current);
        if (morphProgress.current >= 1 && !completed.current) {
          completed.current = true;
          onMorphComplete?.();
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
  onMorphComplete,
}: {
  sourceUrl?: string | null;
  active?: boolean;
  morphUrl?: string | null;
  onMorphComplete?: () => void;
}) {
  const blob = useMemo(
    () => pointGeometry(fibonacciSphere(POINT_COUNT, BLOB_RADIUS)),
    []
  );
  const [loaded, setLoaded] = useState<{
    url: string;
    geom: THREE.BufferGeometry;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Build a point cloud from the previous model's framed surface (revision).
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    new STLLoader().load(
      sourceUrl,
      (g) => {
        if (cancelled) return;
        const samples = frameSamples(g, POINT_COUNT);
        const pos = new Float32Array(POINT_COUNT * 3);
        for (let i = 0; i < POINT_COUNT; i++) {
          pos[i * 3] = samples[i].x;
          pos[i * 3 + 1] = samples[i].y;
          pos[i * 3 + 2] = samples[i].z;
        }
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
  onMorphComplete,
}: {
  className?: string;
  active?: boolean;
  sourceUrl?: string | null;
  morphUrl?: string | null;
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
          onMorphComplete={onMorphComplete}
        />
      </Canvas>
    </div>
  );
}
