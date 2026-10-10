import * as THREE from "three";

/**
 * Parts for the authed-home dropzone backdrop: a playful bench of
 * machine components that lean additive — fan, chunky gear, gyroid
 * heat-exchanger core, tube-wall rocket engine, print-in-place hinge,
 * spring on its seats. Simple enough to read as
 * sketches at ~60px, specific enough to read as real parts.
 *
 * Each builder returns a BufferGeometry with largest extent 1, centred
 * on the origin, so the scene can place them by fraction of the
 * canvas. Curved surfaces are tessellated finely enough that facet
 * edges stay under the drawing's crease angle and draw as silhouettes
 * only. Pure three.js, no React: unit-tested without a canvas.
 */

export type IsometricPartKind =
  | "fan"
  | "gear"
  | "gyroid"
  | "engine"
  | "hinge"
  | "spring";

function finish(geometry: THREE.BufferGeometry, { keepNormals = false } = {}) {
  geometry.center();
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const s = 1 / Math.max(size.x, size.y, size.z);
  geometry.scale(s, s, s);
  if (!keepNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** A flat annulus (washer) extruded along +Z. */
function annulus(outer: number, inner: number, depth: number, segments = 64) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: segments,
  });
}

/**
 * Ducted fan: hub, nine twisted blades and a tip ring.
 */
export function makeRotorGeometry({ blades = 9 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(0.15, 0.15, 0.2, 48);
  parts.push(hub);
  const bore = new THREE.CylinderGeometry(0.06, 0.06, 0.24, 32, 1, true);
  parts.push(bore);
  const ring = annulus(0.5, 0.45, 0.14, 96);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, -0.07, 0);
  parts.push(ring);
  for (let i = 0; i < blades; i++) {
    // Radial span along +X, chord along Z, thin in Y; twisted so the
    // pitch flattens toward the tip.
    const blade = new THREE.BoxGeometry(0.32, 0.018, 0.13, 10, 1, 1);
    blade.translate(0.15 + 0.16, 0, 0);
    const pos = blade.getAttribute("position");
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      const t = (v.x - 0.15) / 0.32;
      v.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.95 - 0.55 * t);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    blade.rotateY((i / blades) * Math.PI * 2);
    parts.push(blade);
  }
  return finish(mergeGeometries(parts));
}

function circlePath(radius: number, cx = 0, cy = 0) {
  const path = new THREE.Path();
  path.absarc(cx, cy, radius, 0, Math.PI * 2, true);
  return path;
}

/**
 * Chunky spur gear: eight big teeth with rounded tips, a plain web and
 * a raised hub. Fewer, fatter features so it reads as a toy-like gear
 * at backdrop size rather than a busy drawing.
 */
export function makeGearGeometry({
  teeth = 8,
  rootRadius = 0.36,
  tipRadius = 0.5,
  boreRadius = 0.1,
  thickness = 0.2,
  hubRadius = 0.18,
  hubHeight = 0.1,
} = {}) {
  const shape = new THREE.Shape();
  const pitch = (Math.PI * 2) / teeth;
  // Each tooth: root flat, flank up, a rounded tip arc, flank down.
  const tipR = (tipRadius * Math.sin(pitch * 0.17)) / 1.0;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch;
    const rootStart = a0;
    const rootEnd = a0 + pitch * 0.32;
    const mid = a0 + pitch * 0.62;
    const p = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
    if (i === 0) shape.moveTo(...p(rootStart, rootRadius));
    shape.absarc(0, 0, rootRadius, rootStart, rootEnd, false);
    const tipCentre = p(mid, tipRadius - tipR);
    const flankAngle = Math.atan2(tipCentre[1], tipCentre[0]);
    shape.absarc(
      tipCentre[0],
      tipCentre[1],
      tipR,
      flankAngle - Math.PI / 2 - 0.25,
      flankAngle + Math.PI / 2 + 0.25,
      false
    );
    shape.lineTo(...p(a0 + pitch, rootRadius));
  }
  shape.closePath();
  shape.holes.push(circlePath(boreRadius));
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 16,
  });
  const hub = annulus(hubRadius, boreRadius, hubHeight, 40);
  hub.translate(0, 0, thickness);
  const merged = mergeGeometries([body, hub]);
  merged.rotateX(-Math.PI / 2);
  return finish(merged);
}

/**
 * Naive surface nets over a scalar field (negative = solid). Returns a
 * non-indexed geometry with normals taken from the field's gradient, so
 * the curved surface shades smoothly instead of faceting.
 */
function surfaceNets(
  field: (x: number, y: number, z: number) => number,
  n: number,
  min: number,
  max: number
) {
  const step = (max - min) / n;
  const N = n + 1;
  const vals = new Float32Array(N * N * N);
  const at = (i: number, j: number, k: number) => i + N * (j + N * k);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        vals[at(i, j, k)] = field(min + i * step, min + j * step, min + k * step);

  const cellVert = new Int32Array(n * n * n).fill(-1);
  const verts: number[] = [];
  const cAt = (i: number, j: number, k: number) => i + n * (j + n * k);
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3],
    [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const v = corners.map(([a, b, c]) => vals[at(i + a, j + b, k + c)]);
        const inside = v.map((x) => x < 0);
        if (inside.every(Boolean) || !inside.some(Boolean)) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [e0, e1] of edges) {
          if (inside[e0] === inside[e1]) continue;
          const t = v[e0] / (v[e0] - v[e1]);
          const c0 = corners[e0];
          const c1 = corners[e1];
          sx += c0[0] + (c1[0] - c0[0]) * t;
          sy += c0[1] + (c1[1] - c0[1]) * t;
          sz += c0[2] + (c1[2] - c0[2]) * t;
          cnt++;
        }
        cellVert[cAt(i, j, k)] = verts.length / 3;
        verts.push(
          min + (i + sx / cnt) * step,
          min + (j + sy / cnt) * step,
          min + (k + sz / cnt) * step
        );
      }

  const pos: number[] = [];
  const nor: number[] = [];
  const h = step * 0.5;
  const grad = (x: number, y: number, z: number) =>
    new THREE.Vector3(
      field(x + h, y, z) - field(x - h, y, z),
      field(x, y + h, z) - field(x, y - h, z),
      field(x, y, z + h) - field(x, y, z - h)
    ).normalize();
  // One gradient per net vertex, shared by every triangle that uses it.
  const vnorm: THREE.Vector3[] = [];
  for (let v = 0; v < verts.length / 3; v++) {
    vnorm.push(grad(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]));
  }
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const tri = (a: number, b: number, c: number) => {
    pa.fromArray(verts, a * 3);
    pb.fromArray(verts, b * 3);
    pc.fromArray(verts, c * 3);
    const fn = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
    const avg = vnorm[a].clone().add(vnorm[b]).add(vnorm[c]);
    // Outward = up the field gradient (field is negative inside).
    const order = fn.dot(avg) < 0 ? [a, c, b] : [a, b, c];
    for (const idx of order) {
      pos.push(verts[idx * 3], verts[idx * 3 + 1], verts[idx * 3 + 2]);
      nor.push(vnorm[idx].x, vnorm[idx].y, vnorm[idx].z);
    }
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tri(a, b, c);
    tri(a, c, d);
  };
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const s0 = vals[at(i, j, k)] < 0;
        if (i < n && j > 0 && k > 0 && j < n && k < n && s0 !== vals[at(i + 1, j, k)] < 0)
          quad(cellVert[cAt(i, j - 1, k - 1)], cellVert[cAt(i, j, k - 1)], cellVert[cAt(i, j, k)], cellVert[cAt(i, j - 1, k)]);
        if (j < n && i > 0 && k > 0 && i < n && k < n && s0 !== vals[at(i, j + 1, k)] < 0)
          quad(cellVert[cAt(i - 1, j, k - 1)], cellVert[cAt(i, j, k - 1)], cellVert[cAt(i, j, k)], cellVert[cAt(i - 1, j, k)]);
        if (k < n && i > 0 && j > 0 && i < n && j < n && s0 !== vals[at(i, j, k + 1)] < 0)
          quad(cellVert[cAt(i - 1, j - 1, k)], cellVert[cAt(i, j - 1, k)], cellVert[cAt(i, j, k)], cellVert[cAt(i - 1, j, k)]);
      }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return geometry;
}

/**
 * Gyroid heat-exchanger core: a block cut through by a gyroid — the
 * triply periodic surface that splits a volume into two interwoven
 * channel networks, hot and cold, and can only be printed.
 */
export function makeGyroidGeometry({ periods = 1.5, gap = 0.36, resolution = 40 } = {}) {
  const half = 1;
  const k = (Math.PI * 2 * periods) / (half * 2);
  const field = (x: number, y: number, z: number) => {
    const g =
      Math.sin(k * x) * Math.cos(k * y) +
      Math.sin(k * y) * Math.cos(k * z) +
      Math.sin(k * z) * Math.cos(k * x);
    // Solid everywhere except a gyroid-shaped gap: the gap is the
    // dividing wall's negative — two interwoven channel networks cut
    // through a block — so every face shows the swirl as slots and the
    // block keeps a clean square outline.
    const channels = gap - Math.abs(g);
    const box = (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - half * 0.94) * 6;
    return Math.max(channels, box);
  };
  return finish(surfaceNets(field, resolution, -half, half), { keepNormals: true });
}

/**
 * Tube-wall rocket engine: injector dome, chamber, throat and bell,
 * with coolant tubes running nozzle-to-throat into a manifold ring at
 * each end — one printed part where the classic
 * build brazes hundreds of tubes.
 */
export function makeEngineGeometry({ tubes = 10 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const bell = (y: number) => 0.11 + 0.26 * (1 - y / 0.5) ** 1.6;
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, 1.02)];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    profile.push(new THREE.Vector2(0.22 * Math.sin((t * Math.PI) / 2), 1.02 - 0.12 * (1 - Math.cos((t * Math.PI) / 2))));
  }
  profile.push(new THREE.Vector2(0.22, 0.72));
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(0.22 - 0.11 * (1 - Math.cos((t * Math.PI) / 2)), 0.72 - 0.22 * t));
  }
  for (let i = 1; i <= 24; i++) {
    const y = 0.5 - (0.5 * i) / 24;
    profile.push(new THREE.Vector2(bell(y) - 0.01, y));
  }
  profile.push(new THREE.Vector2(bell(0) - 0.03, 0), new THREE.Vector2(0.1, 0.45));
  parts.push(new THREE.LatheGeometry(profile, 64));

  const tube = 0.026;
  for (let i = 0; i < tubes; i++) {
    const a = (i / tubes) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 20; s++) {
      const y = 0.04 + (0.44 * s) / 20;
      const r = bell(y) + tube * 0.6;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, tube, 14, false));
  }
  for (const [y, rr] of [
    [0.04, bell(0.04) + tube * 1.5],
    [0.48, bell(0.48) + tube * 1.5],
  ]) {
    const ring = new THREE.TorusGeometry(rr, tube * 1.7, 14, 72);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  // One propellant feed off the dome, flanged.
  const feed = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 24);
  feed.translate(0, 1.08, 0);
  const cap = new THREE.CylinderGeometry(0.085, 0.085, 0.035, 32);
  cap.translate(0, 1.16, 0);
  parts.push(feed, cap);
  const merged = mergeGeometries(parts);
  merged.rotateZ(-0.3);
  return finish(merged);
}

/**
 * Print-in-place hinge: two leaves whose knuckles interlock around a
 * captive pin, printed assembled and already free to swing. Opened to
 * ~120° so the knuckles read.
 */
export function makeHingeGeometry({ knuckles = 5, length = 1 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.09;
  const leafW = 0.42;
  const t = 0.05;
  const seg = length / knuckles;
  const leaf = (angle: number, odd: boolean) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -length / 2);
    shape.lineTo(leafW - 0.08, -length / 2);
    shape.absarc(leafW - 0.08, -length / 2 + 0.08, 0.08, -Math.PI / 2, 0, false);
    shape.lineTo(leafW, length / 2 - 0.08);
    shape.absarc(leafW - 0.08, length / 2 - 0.08, 0.08, 0, Math.PI / 2, false);
    shape.lineTo(0, length / 2);
    shape.closePath();
    for (const y of [-length * 0.28, length * 0.28]) shape.holes.push(circlePath(0.04, leafW * 0.62, y));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -t / 2);
    // Leaf lies in XY, spine along Y at x = 0; swing it about Y.
    g.rotateY(angle);
    parts.push(g);
    for (let i = 0; i < knuckles; i++) {
      if ((i % 2 === 1) !== odd) continue;
      const k = new THREE.CylinderGeometry(r, r, seg * 0.92, 32);
      k.translate(0, -length / 2 + seg * (i + 0.5), 0);
      parts.push(k);
    }
  };
  leaf(0, false);
  leaf((Math.PI * 2) / 3, true);
  const pin = new THREE.CylinderGeometry(r * 0.45, r * 0.45, length + 0.06, 20);
  parts.push(pin);
  const merged = mergeGeometries(parts);
  merged.rotateX(Math.PI / 2);
  return finish(merged);
}

/**
 * Compression spring on its seats: a round-wire helix with closed ends,
 * sitting in a spigoted seat cup at each end — the way it sits in a
 * real assembly.
 */
export function makeSpringGeometry({ turns = 5, radius = 0.26, wire = 0.045 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const seatH = 0.08;
  const height = 0.8;
  const steps = turns * 48;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    // Closed ends: the first and last half-turn flatten onto the seats.
    const e = Math.min(1, t * turns * 2, (1 - t) * turns * 2);
    const y = seatH + wire + THREE.MathUtils.lerp(0, height, THREE.MathUtils.smoothstep(t, 0, 1) * 0.5 + t * 0.5) * (0.85 + 0.15 * e);
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, wire, 16, false));
  const top = pts[pts.length - 1].y + wire;
  const flangeH = seatH * 0.55;
  const seat = (flangeY: number, spigotY: number) => {
    // Seat: a flanged disc with a spigot that centres the coil.
    const flange = new THREE.CylinderGeometry(radius + 0.12, radius + 0.12, flangeH, 48);
    flange.translate(0, flangeY, 0);
    const spigot = new THREE.CylinderGeometry(radius - wire * 1.5, radius - wire * 1.5, seatH, 40);
    spigot.translate(0, spigotY, 0);
    parts.push(flange, spigot);
  };
  seat(flangeH / 2, flangeH + seatH / 2);
  seat(top + flangeH / 2, top - seatH / 2);
  return finish(mergeGeometries(parts));
}

export const PART_BUILDERS: Record<
  IsometricPartKind,
  () => THREE.BufferGeometry
> = {
  fan: () => makeRotorGeometry(),
  gear: () => makeGearGeometry(),
  gyroid: () => makeGyroidGeometry(),
  engine: () => makeEngineGeometry(),
  hinge: () => makeHingeGeometry(),
  spring: () => makeSpringGeometry(),
};

/**
 * Concatenate non-indexed copies of each geometry's position attribute.
 * Local instead of three/examples' mergeGeometries so this module has
 * no addon import and stays trivially testable.
 */
function mergeGeometries(parts: THREE.BufferGeometry[]) {
  const arrays: Float32Array[] = [];
  let total = 0;
  for (const part of parts) {
    const flat = part.index ? part.toNonIndexed() : part;
    const pos = flat.getAttribute("position").array as Float32Array;
    arrays.push(pos);
    total += pos.length;
    if (flat !== part) flat.dispose();
    part.dispose();
  }
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(out, 3));
  return geometry;
}
