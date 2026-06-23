"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";

/**
 * A wireframe icosahedron whose mesh slowly deforms via a noise displacement —
 * the idle/"working" visual for the text-to-CAD studio. When handed a `morphUrl`
 * (the freshly generated STL), it morphs: every vertex flies from its deforming
 * sphere position onto a matching point on the generated shape's surface, so the
 * result appears to materialize OUT of the cloud. The studio then crossfades to
 * the crisp model (whose geometry is already warm in the loader cache).
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uMorph;
  attribute vec3 aTarget;
  varying float vD;

  // Cheap, smooth pseudo-noise from layered sines — no texture, GPU-friendly.
  float n(vec3 p) {
    return sin(p.x * 2.0 + uTime)
         * sin(p.y * 2.0 + uTime * 1.2)
         * sin(p.z * 2.0 + uTime * 0.8);
  }

  void main() {
    float d = n(position * 1.4 + uTime * 0.15);
    vD = d;
    vec3 displaced = position + normal * d * uAmp;
    // Morph from the deforming sphere onto the generated shape's surface.
    vec3 pos = mix(displaced, aTarget, uMorph);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vD;

  void main() {
    float a = clamp(0.5 + 0.3 * vD, 0.18, 0.85);
    gl_FragColor = vec4(uColor, a);
  }
`;

const BLOB_RADIUS = 1.3;
const BLOB_DETAIL = 6; // ~245k verts; dense wireframe, snappy morph compute.
const MORPH_DURATION = 1.3; // seconds

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Area-weighted surface samples of a mesh (model space). */
function sampleSurface(geom: THREE.BufferGeometry, n: number): THREE.Vector3[] {
  const pos = geom.attributes.position;
  const index = geom.index;
  const triCount = (index ? index.count : pos.count) / 3;
  const vi = (i: number) => (index ? index.getX(i) : i);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cum = new Float32Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, vi(t * 3));
    b.fromBufferAttribute(pos, vi(t * 3 + 1));
    c.fromBufferAttribute(pos, vi(t * 3 + 2));
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    total += area;
    cum[t] = total;
  }

  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    // Stratified target area + binary search for the triangle.
    const target = ((i + Math.random()) / n) * total;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    a.fromBufferAttribute(pos, vi(lo * 3));
    b.fromBufferAttribute(pos, vi(lo * 3 + 1));
    c.fromBufferAttribute(pos, vi(lo * 3 + 2));
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    out.push(
      new THREE.Vector3()
        .copy(a)
        .addScaledVector(ab.subVectors(b, a), u)
        .addScaledVector(ac.subVectors(c, a), v)
    );
  }
  return out;
}

/** Stable ordering key: latitude band, then longitude. */
function angleKey(v: { x: number; y: number; z: number }): number {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, v.y / r))); // -π/2..π/2
  const azimuth = Math.atan2(v.z, v.x); // -π..π
  // Pack: elevation dominates, azimuth breaks ties.
  return elevation * 100 + azimuth;
}

/**
 * Build the per-vertex morph targets: sample the model surface, normalize it to
 * the blob's scale, and match samples to blob vertices by angular position so
 * the cloud "wraps" onto the shape. Duplicate (non-indexed) blob verts at the
 * same position share a target to avoid tearing.
 */
function computeMorphTargets(
  blobGeom: THREE.BufferGeometry,
  modelGeom: THREE.BufferGeometry
): Float32Array {
  const bpos = blobGeom.attributes.position;
  const vCount = bpos.count;

  // Unique blob positions (welded by quantized key).
  const uniqueKeyToIndex = new Map<string, number>();
  const uniqueBase: THREE.Vector3[] = [];
  const vertToUnique = new Int32Array(vCount);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < vCount; i++) {
    tmp.fromBufferAttribute(bpos, i);
    const key = `${Math.round(tmp.x * 1e4)},${Math.round(
      tmp.y * 1e4
    )},${Math.round(tmp.z * 1e4)}`;
    let u = uniqueKeyToIndex.get(key);
    if (u === undefined) {
      u = uniqueBase.length;
      uniqueKeyToIndex.set(key, u);
      uniqueBase.push(tmp.clone());
    }
    vertToUnique[i] = u;
  }
  const U = uniqueBase.length;

  // Sample + normalize the model to the blob's scale (centered, ~same radius).
  const samples = sampleSurface(modelGeom, U);
  const centroid = new THREE.Vector3();
  for (const s of samples) centroid.add(s);
  centroid.multiplyScalar(1 / U);
  let maxR = 1e-6;
  for (const s of samples) maxR = Math.max(maxR, s.distanceTo(centroid));
  const scale = (BLOB_RADIUS * 1.05) / maxR;
  for (const s of samples) s.sub(centroid).multiplyScalar(scale);

  // Match by angular order so vertices land on a corresponding surface region.
  const blobOrder = [...Array(U).keys()].sort(
    (x, y) => angleKey(uniqueBase[x]) - angleKey(uniqueBase[y])
  );
  const sampleOrder = [...Array(U).keys()].sort(
    (x, y) => angleKey(samples[x]) - angleKey(samples[y])
  );
  const uniqueTarget: THREE.Vector3[] = new Array(U);
  for (let k = 0; k < U; k++) uniqueTarget[blobOrder[k]] = samples[sampleOrder[k]];

  // Expand to every (possibly duplicated) blob vertex.
  const target = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const s = uniqueTarget[vertToUnique[i]];
    target[i * 3] = s.x;
    target[i * 3 + 1] = s.y;
    target[i * 3 + 2] = s.z;
  }
  return target;
}

function Blob({
  active,
  morphUrl,
  onMorphComplete,
}: {
  active: boolean;
  morphUrl?: string | null;
  onMorphComplete?: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const speed = useRef(0.6);
  const amp = useRef(0.16);
  const morphProgress = useRef(0); // 0..1, advances once targets are ready
  const morphing = useRef(false);
  const completed = useRef(false);

  const geom = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(BLOB_RADIUS, BLOB_DETAIL);
    // Seed aTarget with base positions so uMorph is a no-op until a real
    // target is computed.
    g.setAttribute(
      "aTarget",
      new THREE.BufferAttribute(
        (g.attributes.position.array as Float32Array).slice(),
        3
      )
    );
    return g;
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.16 },
      uMorph: { value: 0 },
      uColor: { value: new THREE.Color("#8aa0e8") },
    }),
    []
  );

  // Load the target STL, compute morph targets, and start the morph. On any
  // failure, complete immediately so the studio still reveals the model.
  useEffect(() => {
    if (!morphUrl) return;
    let cancelled = false;
    // The blob persists across generations — reset morph state so a stale
    // "completed" ref from a previous build doesn't skip this morph.
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
          const targets = computeMorphTargets(geom, modelGeom);
          geom.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
          morphProgress.current = 0;
          morphing.current = true;
        } catch {
          onMorphComplete?.();
        }
      },
      undefined,
      () => onMorphComplete?.()
    );
    // Safety: never strand on the loader if something hangs.
    const safety = setTimeout(() => onMorphComplete?.(), 8000);
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, [morphUrl, geom, onMorphComplete]);

  useFrame((_, delta) => {
    const k = Math.min(1, delta * 2.5);
    speed.current += ((active ? 1.7 : 0.6) - speed.current) * k;
    amp.current += ((active ? 0.24 : 0.16) - amp.current) * k;

    if (matRef.current) {
      matRef.current.uniforms.uTime.value += delta * speed.current;
      matRef.current.uniforms.uAmp.value = amp.current;
      if (morphing.current) {
        morphProgress.current = Math.min(
          1,
          morphProgress.current + delta / MORPH_DURATION
        );
        matRef.current.uniforms.uMorph.value = smoothstep(
          morphProgress.current
        );
        if (morphProgress.current >= 1 && !completed.current) {
          completed.current = true;
          onMorphComplete?.();
        }
      }
    }
    if (meshRef.current) {
      const rot = active ? 0.12 : 0.07;
      meshRef.current.rotation.y += delta * rot;
      meshRef.current.rotation.x += delta * rot * 0.3;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geom}>
      <shaderMaterial
        ref={matRef}
        wireframe
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
      />
    </mesh>
  );
}

export function MaterializingBlob({
  className,
  active = false,
  morphUrl,
  onMorphComplete,
}: {
  className?: string;
  /** Speed up + churn harder while a shape is generating. */
  active?: boolean;
  /** STL to morph into once generation is done (null = keep deforming). */
  morphUrl?: string | null;
  /** Fired when the morph finishes (or fails) — cue to reveal the model. */
  onMorphComplete?: () => void;
}) {
  return (
    <div className={className}>
      {/* Camera pulled back so the blob reads as a small "entity" with room
          around it, not a sphere filling the frame. */}
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 2]}>
        <Blob
          active={active}
          morphUrl={morphUrl}
          onMorphComplete={onMorphComplete}
        />
      </Canvas>
    </div>
  );
}
