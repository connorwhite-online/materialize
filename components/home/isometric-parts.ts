import * as THREE from "three";

/**
 * Parts for the authed-home dropzone backdrop: a playful bench of
 * primitive machine components — fan, gear, heat exchanger, a little
 * rocket booster, a ball bearing, a spring. Simple enough to read as
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
  | "exchanger"
  | "rocket"
  | "bearing"
  | "spring";

function finish(geometry: THREE.BufferGeometry) {
  geometry.center();
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const s = 1 / Math.max(size.x, size.y, size.z);
  geometry.scale(s, s, s);
  geometry.computeVertexNormals();
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
 * Spur gear: twelve trapezoid teeth, six lightening holes in the web,
 * a hub boss and a keyed bore. Laid flat so its face shows as the
 * isometric ellipse.
 */
export function makeGearGeometry({
  teeth = 12,
  rootRadius = 0.4,
  tipRadius = 0.5,
  boreRadius = 0.12,
  thickness = 0.16,
  hubRadius = 0.2,
  hubHeight = 0.1,
} = {}) {
  const shape = new THREE.Shape();
  const pitch = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch;
    const pts: [number, number][] = [
      [a0, rootRadius],
      [a0 + pitch * 0.3, rootRadius],
      [a0 + pitch * 0.39, tipRadius],
      [a0 + pitch * 0.61, tipRadius],
      [a0 + pitch * 0.7, rootRadius],
    ];
    pts.forEach(([a, r], k) => {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  // Keyed bore: a circle with a square notch on +X.
  const bore = new THREE.Path();
  const keyHalf = boreRadius * 0.38;
  const keyDepth = boreRadius * 0.45;
  const keyAngle = Math.asin(keyHalf / boreRadius);
  bore.moveTo(boreRadius + keyDepth, -keyHalf);
  bore.lineTo(boreRadius + keyDepth, keyHalf);
  for (let i = 0; i <= 28; i++) {
    const a = keyAngle + (i / 28) * (Math.PI * 2 - keyAngle * 2);
    bore.lineTo(Math.cos(a) * boreRadius, Math.sin(a) * boreRadius);
  }
  bore.closePath();
  shape.holes.push(bore);

  const web = (hubRadius + rootRadius) / 2;
  const holeRadius = (rootRadius - hubRadius) * 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    shape.holes.push(circlePath(holeRadius, Math.cos(a) * web, Math.sin(a) * web));
  }
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 20,
  });
  const hub = annulus(hubRadius, boreRadius, hubHeight, 40);
  hub.translate(0, 0, thickness);
  const merged = mergeGeometries([body, hub]);
  merged.rotateX(-Math.PI / 2);
  return finish(merged);
}

/**
 * Finned heat exchanger: a base block, a row of thin fins and two
 * coolant pipes running through the fin stack, stubbed out both ends.
 */
export function makeExchangerGeometry({ fins = 9 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const width = 1;
  const depth = 0.56;
  const base = new THREE.BoxGeometry(width, 0.1, depth);
  base.translate(0, 0.05, 0);
  parts.push(base);
  const finHeight = 0.42;
  const pitch = (width - 0.08) / (fins - 1);
  for (let i = 0; i < fins; i++) {
    const fin = new THREE.BoxGeometry(0.03, finHeight, depth);
    fin.translate(-width / 2 + 0.04 + i * pitch, 0.1 + finHeight / 2, 0);
    parts.push(fin);
  }
  for (const z of [-depth * 0.22, depth * 0.22]) {
    const pipe = new THREE.CylinderGeometry(0.055, 0.055, width + 0.24, 32);
    pipe.rotateZ(Math.PI / 2);
    pipe.translate(0, 0.1 + finHeight * 0.55, z);
    parts.push(pipe);
    for (const sx of [-1, 1]) {
      const collar = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 32);
      collar.rotateZ(Math.PI / 2);
      collar.translate(sx * (width / 2 + 0.12), 0.1 + finHeight * 0.55, z);
      parts.push(collar);
    }
  }
  return finish(mergeGeometries(parts));
}

/**
 * A little rocket booster, cartoon-proportioned: ogive nose, round
 * body with a porthole and a stage band, four swept fins and a nozzle
 * bell. Tilted a touch, mid-launch.
 */
export function makeRocketGeometry({ fins = 4 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.16;
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, 1)];
  // Ogive nose.
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    profile.push(new THREE.Vector2(r * Math.sin((t * Math.PI) / 2) ** 0.8, 1 - 0.32 * t));
  }
  profile.push(new THREE.Vector2(r, 0.22), new THREE.Vector2(r * 0.86, 0.16));
  profile.push(new THREE.Vector2(r * 0.55, 0.15));
  // Nozzle bell.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(r * 0.4 + r * 0.42 * t ** 1.4, 0.15 - 0.13 * t));
  }
  profile.push(new THREE.Vector2(r * 0.74, 0.02), new THREE.Vector2(0, 0.08));
  parts.push(new THREE.LatheGeometry(profile, 64));

  const band = new THREE.TorusGeometry(r + 0.008, 0.014, 12, 64);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0.5, 0);
  parts.push(band);

  // Porthole: a ring and a domed glass, facing the viewer's side.
  const port = new THREE.TorusGeometry(0.05, 0.013, 12, 40);
  port.translate(0, 0.66, r);
  parts.push(port);
  const glass = new THREE.SphereGeometry(0.045, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  glass.rotateX(Math.PI / 2);
  glass.scale(1, 1, 0.35);
  glass.translate(0, 0.66, r - 0.005);
  parts.push(glass);

  const fin = new THREE.Shape();
  fin.moveTo(0, 0.38);
  fin.lineTo(0, 0.12);
  fin.lineTo(0.17, 0.0);
  fin.lineTo(0.17, 0.1);
  fin.closePath();
  for (let i = 0; i < fins; i++) {
    const geo = new THREE.ExtrudeGeometry(fin, { depth: 0.024, bevelEnabled: false });
    geo.translate(r - 0.01, 0, -0.012);
    geo.rotateY((i / fins) * Math.PI * 2 + Math.PI / 4);
    parts.push(geo);
  }
  const merged = mergeGeometries(parts);
  merged.rotateZ(-0.32);
  return finish(merged);
}

/**
 * Deep-groove ball bearing, unshielded so the balls show: outer race,
 * inner race, ten balls between them.
 */
export function makeBearingGeometry({ balls = 10 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const width = 0.2;
  const race = (outer: number, inner: number) => {
    const g = annulus(outer, inner, width, 72);
    g.translate(0, 0, -width / 2);
    return g;
  };
  parts.push(race(0.5, 0.41), race(0.24, 0.13));
  const pitch = (0.41 + 0.24) / 2;
  const ballR = (0.41 - 0.24) / 2 + 0.005;
  for (let i = 0; i < balls; i++) {
    const a = (i / balls) * Math.PI * 2;
    const ball = new THREE.SphereGeometry(ballR, 24, 16);
    ball.translate(Math.cos(a) * pitch, Math.sin(a) * pitch, 0);
    parts.push(ball);
  }
  const merged = mergeGeometries(parts);
  merged.rotateX(-Math.PI / 2 + 0.25);
  return finish(merged);
}

/**
 * Compression spring: a round-wire helix with closed, flat end coils.
 */
export function makeSpringGeometry({ turns = 6, radius = 0.3, wire = 0.05 } = {}) {
  const pts: THREE.Vector3[] = [];
  const steps = turns * 48;
  const height = 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    // Closed ends: the first and last turn barely climb.
    const ends = Math.min(1, t * turns, (1 - t) * turns);
    const y = THREE.MathUtils.lerp(0, height, t) * 0.92 + 0.04 * (1 - ends) * (t > 0.5 ? 1 : -1);
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, wire, 16, false);
  return finish(mergeGeometries([coil]));
}

export const PART_BUILDERS: Record<
  IsometricPartKind,
  () => THREE.BufferGeometry
> = {
  fan: () => makeRotorGeometry(),
  gear: () => makeGearGeometry(),
  exchanger: () => makeExchangerGeometry(),
  rocket: () => makeRocketGeometry(),
  bearing: () => makeBearingGeometry(),
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
