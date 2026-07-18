import * as THREE from "three";

/**
 * Shared framing for the text-to-CAD studio viewer. The loader (deforming
 * blob / previous model) and the crisp model render in separate passes but MUST
 * line up pixel-for-pixel so the hand-off looks like one continuous object
 * morphing — no reload, no zoom, no rescale. The only way to guarantee that is
 * a FIXED camera plus a deterministic "fit every mesh to the same on-screen
 * size" rule, shared by both. (The model viewer's default `<Stage adjustCamera>`
 * fits each model differently and animates the camera on mount — that mismatch
 * is exactly what caused the jarring pop.)
 */

/** Fixed camera for the studio viewer (both the loader and the model use it). */
export const STUDIO_CAMERA = {
  position: [0, 0, 6] as [number, number, number],
  fov: 40,
};

/** Longest axis of any model is scaled to this many world units, then centered.
 *  With the camera above, that frames the part with comfortable margin. */
export const STUDIO_TARGET_SIZE = 3.2;

export interface FrameTransform {
  /** Uniform scale to apply to the wrapping group. */
  scale: number;
  /** Group position so the (scaled) geometry is centered at the origin. */
  position: [number, number, number];
}

/**
 * Transform that fits a geometry's bounding box to STUDIO_TARGET_SIZE and
 * centers it. Apply to the GROUP wrapping the mesh (not the geometry) so the
 * geometry keeps its real millimetre coordinates — the inspect dimensions
 * readout depends on that.
 */
export function frameTransformFor(geometry: THREE.BufferGeometry): FrameTransform {
  const { center, scale } = fitMetrics(geometry);
  return {
    scale,
    position: [-center.x * scale, -center.y * scale, -center.z * scale],
  };
}

/**
 * Shared frame for a multi-part assembly: fit the UNION of all part bounding
 * boxes (parts stay in their native assembly coordinates). Used for the
 * "All parts" overview — part-tab isolation switches to the single-solid
 * frame so the selected part fills the viewport (MTR-174).
 */
export function frameTransformForAll(
  geometries: THREE.BufferGeometry[]
): FrameTransform {
  const union = new THREE.Box3();
  for (const g of geometries) {
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) union.union(g.boundingBox);
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  union.getSize(size);
  union.getCenter(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = STUDIO_TARGET_SIZE / longest;
  return {
    scale,
    position: [-center.x * scale, -center.y * scale, -center.z * scale],
  };
}

/** Shared fit: centroid of the bbox + uniform scale to STUDIO_TARGET_SIZE. */
function fitMetrics(geometry: THREE.BufferGeometry): {
  center: THREE.Vector3;
  scale: number;
} {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  return { center, scale: STUDIO_TARGET_SIZE / longest };
}

/**
 * Clone a geometry baked into the shared studio frame (centered + scaled to
 * STUDIO_TARGET_SIZE), with recomputed normals. Used as the deform base for a
 * revision (the previous model wobbling in place) so its verts live in the same
 * space as the morph targets and the fixed-frame crisp viewer.
 */
export function frameBakeGeometry(
  geometry: THREE.BufferGeometry
): THREE.BufferGeometry {
  const g = geometry.clone();
  const { center, scale } = fitMetrics(g);
  g.translate(-center.x, -center.y, -center.z);
  g.scale(scale, scale, scale);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Area-weighted surface samples of a mesh (in the geometry's own space). */
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
    total += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    cum[t] = total;
  }

  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
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

/** Surface samples mapped into the shared studio frame (matches frameBakeGeometry). */
export function frameSamples(
  geometry: THREE.BufferGeometry,
  n: number
): THREE.Vector3[] {
  const samples = sampleSurface(geometry, n);
  const { center, scale } = fitMetrics(geometry);
  for (const v of samples) v.sub(center).multiplyScalar(scale);
  return samples;
}
