import * as THREE from "three";
import type { IsometricPalette } from "./palette";
import { isometricMatrix } from "./pose";
import {
  EDGE_DETECT_FRAG,
  EDGE_FRAG,
  EDGE_VERT,
  NORMAL_DEPTH_FRAG,
  TONE_FRAG,
  TONE_VERT,
} from "./shaders";

/**
 * Bakes isometric drawings to images with one shared, offscreen WebGL
 * renderer.
 *
 * A drawing never changes once posed — one view, fixed tones — so
 * there is no reason to keep a live canvas per drawing. Each bake is
 * three draws into a small target, read back as a PNG blob URL, and the
 * GPU goes idle. The page then shows plain `<img>`s: any number of
 * drawings costs one WebGL context total (browsers cap live contexts
 * at ~16), animation is a compositor-only CSS transform, and a drawing
 * that scrolls off-screen costs nothing.
 *
 * Client-only: call from effects.
 */

export type BakeOptions = {
  /** CSS pixels per model unit. Parts are built at largest extent 1. */
  pxPerUnit: number;
  palette: IsometricPalette;
  /** Yaw (radians) applied before the isometric pose. */
  yaw?: number;
  /** Line width in CSS pixels. */
  lineWidth?: number;
  /** Folds sharper than this (degrees) get a line. */
  creaseDeg?: number;
  /** Device pixel ratio to bake at. Floors at 2 so lines stay crisp. */
  dpr?: number;
  /** Label for the `performance.measure` entry each bake records. */
  label?: string;
};

export type BakedDrawing = {
  url: string;
  /** Image size in CSS pixels. */
  width: number;
  height: number;
  /** Where the model's origin lands inside the image, in CSS pixels. */
  originX: number;
  originY: number;
};

let renderer: THREE.WebGLRenderer | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement("canvas");
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  // Shaders write display-ready sRGB; skip the output conversion.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  canvas.addEventListener("webglcontextlost", () => {
    renderer = null;
  });
  return renderer;
}

const vec3 = (c: readonly [number, number, number]) =>
  new THREE.Vector3(c[0], c[1], c[2]);

function bakeNow(
  source: THREE.BufferGeometry,
  opts: BakeOptions
): Promise<BakedDrawing> {
  const gl = getRenderer();
  const lineWidth = opts.lineWidth ?? 1.25;
  // Bake at twice the display density and let the browser downsample:
  // that's the antialiasing (the targets themselves are not MSAA).
  const dpr = Math.min(Math.max(2, opts.dpr ?? 2), 3) * 2;
  const t0 = performance.now();
  const ppu = opts.pxPerUnit;

  const geometry = source.clone();
  geometry.applyMatrix4(isometricMatrix(opts.yaw ?? 0));
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  // Pad so the outer ink line isn't clipped by the image edge.
  const pad = Math.ceil(lineWidth * 2 + 1);
  const width = Math.ceil((box.max.x - box.min.x) * ppu) + pad * 2;
  const height = Math.ceil((box.max.y - box.min.y) * ppu) + pad * 2;
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);

  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const halfW = width / ppu / 2;
  const halfH = height / ppu / 2;
  const depth = box.max.z - box.min.z;
  const camera = new THREE.OrthographicCamera(
    cx - halfW,
    cx + halfW,
    cy + halfH,
    cy - halfH,
    0.01,
    depth + 0.02
  );
  camera.position.set(0, 0, box.max.z + 0.01);
  camera.updateProjectionMatrix();

  const toneMat = new THREE.ShaderMaterial({
    vertexShader: TONE_VERT,
    fragmentShader: TONE_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTop: { value: vec3(opts.palette.top) },
      uLeft: { value: vec3(opts.palette.left) },
      uRight: { value: vec3(opts.palette.right) },
    },
  });
  const ndMat = new THREE.ShaderMaterial({
    vertexShader: TONE_VERT,
    fragmentShader: NORMAL_DEPTH_FRAG,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, toneMat);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const toneTarget = new THREE.WebGLRenderTarget(pw, ph, {
    type: THREE.UnsignedByteType,
  });
  const ndTarget = new THREE.WebGLRenderTarget(pw, ph, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  gl.setPixelRatio(1);
  gl.setSize(pw, ph, false);

  gl.setRenderTarget(toneTarget);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, camera);

  mesh.material = ndMat;
  gl.setRenderTarget(ndTarget);
  // Empty pixels: neutral normal, depth 1 (far).
  gl.setClearColor(new THREE.Color(0.5, 0.5, 0.5), 1);
  gl.clear();
  gl.render(scene, camera);

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  const edgeTarget = new THREE.WebGLRenderTarget(pw, ph, {
    type: THREE.UnsignedByteType,
  });
  const detectMat = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_DETECT_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tNormalDepth: { value: ndTarget.texture },
      uTexel: { value: new THREE.Vector2(1 / pw, 1 / ph) },
      uCreaseCos: {
        value: Math.cos(THREE.MathUtils.degToRad(opts.creaseDeg ?? 28)),
      },
      // Second difference of depth, as a fraction of the part's depth.
      uDepthEps: { value: 0.004 },
    },
  });
  quad.material = detectMat;
  gl.setRenderTarget(edgeTarget);
  gl.render(quadScene, camera);

  const edgeMat = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tTone: { value: toneTarget.texture },
      tEdges: { value: edgeTarget.texture },
      uTexel: { value: new THREE.Vector2(1 / pw, 1 / ph) },
      uRadius: { value: (lineWidth * dpr) / 2 },
      uInk: { value: vec3(opts.palette.ink) },
    },
  });
  quad.material = edgeMat;
  gl.setRenderTarget(null);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(quadScene, camera);

  const dispose = () => {
    geometry.dispose();
    toneMat.dispose();
    ndMat.dispose();
    edgeMat.dispose();
    detectMat.dispose();
    edgeTarget.dispose();
    quad.geometry.dispose();
    toneTarget.dispose();
    ndTarget.dispose();
  };

  return new Promise<BakedDrawing>((resolve, reject) => {
    gl.domElement.toBlob((blob) => {
      dispose();
      performance.measure(`isometric-bake:${opts.label ?? "drawing"}`, {
        start: t0,
        end: performance.now(),
      });
      if (!blob) return reject(new Error("isometric bake: empty canvas"));
      resolve({
        url: URL.createObjectURL(blob),
        width,
        height,
        originX: (0 - (cx - halfW)) * ppu,
        originY: (cy + halfH - 0) * ppu,
      });
    }, "image/png");
  });
}

/**
 * Bake one drawing. Bakes are serialised through the shared renderer,
 * so callers can fire them in parallel. The caller owns the returned
 * blob URL (revoke it when done).
 */
export function bakeIsometric(
  geometry: THREE.BufferGeometry,
  opts: BakeOptions
): Promise<BakedDrawing> {
  const run = queue.then(() => bakeNow(geometry, opts));
  queue = run.catch(() => undefined);
  return run;
}
