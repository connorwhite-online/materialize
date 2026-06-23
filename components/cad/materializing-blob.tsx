"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import {
  STUDIO_CAMERA,
  STUDIO_TARGET_SIZE,
  frameBakeGeometry,
  frameSamples,
} from "./studio-frame";

/**
 * The studio's deforming "loader" + morph renderer. One canvas, one fixed
 * camera, everything normalized to the shared studio frame so it lines up
 * pixel-for-pixel with the crisp <ModelViewer fixedFrame> — the morph hand-off
 * is then seamless (no reload / zoom / rescale).
 *
 * Three cases, all unified:
 *  - fresh build  → a wireframe icosahedron "blob" deforms, then morphs into
 *    the generated shape.
 *  - revision     → the PREVIOUS model (solid, same shader as the crisp viewer)
 *    deforms in place, then reshapes into the new model — reads as "editing
 *    this object."
 *  - idle/empty   → the calm wireframe blob.
 */

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uMorph;
  uniform float uFreq;
  attribute vec3 aTarget;
  varying float vD;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  float n(vec3 p) {
    return sin(p.x * 2.0 + uTime)
         * sin(p.y * 2.0 + uTime * 1.2)
         * sin(p.z * 2.0 + uTime * 0.8);
  }

  void main() {
    // uFreq compensates for blob size so the ripple density (not just the
    // amplitude) stays constant regardless of radius.
    float d = n(position * uFreq + uTime * 0.15);
    vD = d;
    vec3 displaced = position + normal * d * uAmp;
    vec3 pos = mix(displaced, aTarget, uMorph);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewDir = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

// Wireframe blob fragment — translucent, tinted by the noise displacement.
const FRAG_WIRE = /* glsl */ `
  uniform vec3 uColor;
  varying float vD;
  void main() {
    float a = clamp(0.5 + 0.3 * vD, 0.18, 0.85);
    gl_FragColor = vec4(uColor, a);
  }
`;

// Solid fragment — the SAME self-lit shading as MaterializeMaterial (the crisp
// viewer), so a deforming solid revision matches the model it morphs into.
const FRAG_SOLID = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uAccentColor;
  uniform vec3 uFresnelColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vViewDir);
    float hemisphere = N.y * 0.5 + 0.5;
    vec3 baseLight = mix(uAccentColor, uBaseColor, hemisphere);
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
    baseLight += vec3(0.18) * max(dot(N, lightDir), 0.0);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.4;
    vec3 color = mix(baseLight, uFresnelColor, fresnel);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Smaller than the model's frame fit so the fresh-build blob reads as a compact
// "forming" entity with margin; the morph then grows it out into the full shape.
const BLOB_RADIUS = STUDIO_TARGET_SIZE * 0.34;
const BLOB_DETAIL = 6;
const MORPH_DURATION = 1.2;

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Stable ordering key around the sphere: latitude band, then longitude. */
function angleKey(v: { x: number; y: number; z: number }): number {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, v.y / r)));
  const azimuth = Math.atan2(v.z, v.x);
  return elevation * 100 + azimuth;
}

/**
 * Per-vertex morph targets: framed surface samples of the new model, matched to
 * the base mesh's vertices by angular position so the cloud "wraps" onto the
 * shape. Duplicate base verts (same position) share a target to avoid tearing.
 */
function computeMorphTargets(
  baseGeom: THREE.BufferGeometry,
  modelGeom: THREE.BufferGeometry
): Float32Array {
  const bpos = baseGeom.attributes.position;
  const vCount = bpos.count;

  const keyToUnique = new Map<string, number>();
  const uniqueBase: THREE.Vector3[] = [];
  const vertToUnique = new Int32Array(vCount);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < vCount; i++) {
    tmp.fromBufferAttribute(bpos, i);
    const key = `${Math.round(tmp.x * 1e3)},${Math.round(
      tmp.y * 1e3
    )},${Math.round(tmp.z * 1e3)}`;
    let u = keyToUnique.get(key);
    if (u === undefined) {
      u = uniqueBase.length;
      keyToUnique.set(key, u);
      uniqueBase.push(tmp.clone());
    }
    vertToUnique[i] = u;
  }
  const U = uniqueBase.length;

  // Framed samples of the new model (same normalization the crisp viewer uses).
  const samples = frameSamples(modelGeom, U);

  const baseOrder = [...Array(U).keys()].sort(
    (x, y) => angleKey(uniqueBase[x]) - angleKey(uniqueBase[y])
  );
  const sampleOrder = [...Array(U).keys()].sort(
    (x, y) => angleKey(samples[x]) - angleKey(samples[y])
  );
  const uniqueTarget: THREE.Vector3[] = new Array(U);
  for (let k = 0; k < U; k++)
    uniqueTarget[baseOrder[k]] = samples[sampleOrder[k]];

  const target = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const s = uniqueTarget[vertToUnique[i]];
    target[i * 3] = s.x;
    target[i * 3 + 1] = s.y;
    target[i * 3 + 2] = s.z;
  }
  return target;
}

/** Attach (or reset) an aTarget attribute = a copy of the base positions. */
function seedTarget(geom: THREE.BufferGeometry) {
  geom.setAttribute(
    "aTarget",
    new THREE.BufferAttribute(
      (geom.attributes.position.array as Float32Array).slice(),
      3
    )
  );
}

function TransitionMesh({
  baseGeom,
  solid,
  active,
  morphUrl,
  onMorphComplete,
}: {
  baseGeom: THREE.BufferGeometry;
  solid: boolean;
  active: boolean;
  morphUrl?: string | null;
  onMorphComplete?: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const speed = useRef(0.6);
  const amp = useRef(0);
  const morphProgress = useRef(0);
  const morphing = useRef(false);
  const completed = useRef(false);

  // Gentler wobble on a detailed solid; bigger on the abstract blob. Higher
  // noise frequency on the (smaller) blob keeps its surface lively.
  const idleAmp = solid ? 0.012 : 0.18;
  const activeAmp = solid ? 0.06 : 0.3;
  const freq = solid ? 1.4 : 2.1;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: idleAmp },
      uMorph: { value: 0 },
      uFreq: { value: freq },
      uColor: { value: new THREE.Color("#8aa0e8") },
      uBaseColor: { value: new THREE.Color("#d4d4d8") },
      uAccentColor: { value: new THREE.Color("#a1a1aa") },
      uFresnelColor: { value: new THREE.Color("#e4e4e7") },
    }),
    [idleAmp, freq]
  );

  // Load the morph target, compute correspondence, run the morph. Fail-open:
  // any error completes immediately so the studio still reveals the model.
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
          const targets = computeMorphTargets(baseGeom, modelGeom);
          baseGeom.setAttribute(
            "aTarget",
            new THREE.BufferAttribute(targets, 3)
          );
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
    if (meshRef.current) {
      const rot = active ? 0.1 : 0.06;
      meshRef.current.rotation.y += delta * rot;
      meshRef.current.rotation.x += delta * rot * 0.3;
    }
  });

  return (
    <mesh ref={meshRef} geometry={baseGeom}>
      {solid ? (
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG_SOLID}
        />
      ) : (
        <shaderMaterial
          ref={matRef}
          wireframe
          transparent
          depthWrite={false}
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG_WIRE}
        />
      )}
    </mesh>
  );
}

/** Picks the base geometry: the previous model (solid) or the blob (wireframe). */
function TransitionScene({
  sourceUrl,
  active,
  morphUrl,
  onMorphComplete,
}: {
  sourceUrl?: string | null;
  active: boolean;
  morphUrl?: string | null;
  onMorphComplete?: () => void;
}) {
  const blob = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(BLOB_RADIUS, BLOB_DETAIL);
    seedTarget(g);
    return g;
  }, []);

  // Loaded+baked previous model, tagged with the url it came from so a stale
  // geometry is never used after sourceUrl changes (no synchronous reset needed).
  const [loaded, setLoaded] = useState<{
    url: string;
    geom: THREE.BufferGeometry;
  } | null>(null);

  // Load + frame-bake the previous model for the revise-in-place deform.
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    new STLLoader().load(
      sourceUrl,
      (g) => {
        if (cancelled) return;
        const baked = frameBakeGeometry(g);
        seedTarget(baked);
        setLoaded({ url: sourceUrl, geom: baked });
      },
      undefined,
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  const sourceGeom =
    sourceUrl && loaded?.url === sourceUrl ? loaded.geom : null;
  const useSolid = !!sourceGeom;
  const baseGeom = sourceGeom ?? blob;

  return (
    <>
      <ambientLight intensity={0.7} />
      <TransitionMesh
        key={useSolid ? "solid" : "blob"}
        baseGeom={baseGeom}
        solid={useSolid}
        active={active}
        morphUrl={morphUrl}
        onMorphComplete={onMorphComplete}
      />
    </>
  );
}

export function MaterializingBlob({
  className,
  active = false,
  sourceUrl,
  morphUrl,
  onMorphComplete,
}: {
  className?: string;
  /** Deform harder/faster while a shape is generating. */
  active?: boolean;
  /** Previous model to deform in place (revision). Null = wireframe blob. */
  sourceUrl?: string | null;
  /** New model to morph into once generation is done. */
  morphUrl?: string | null;
  /** Fired when the morph finishes (or fails) — cue to reveal the model. */
  onMorphComplete?: () => void;
}) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: STUDIO_CAMERA.position, fov: STUDIO_CAMERA.fov }}
        dpr={[1, 2]}
      >
        <TransitionScene
          sourceUrl={sourceUrl}
          active={active}
          morphUrl={morphUrl}
          onMorphComplete={onMorphComplete}
        />
      </Canvas>
    </div>
  );
}
