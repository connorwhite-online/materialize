import * as THREE from "three";

/**
 * Parts for the authed-home dropzone backdrop: a playful bench of
 * machine components that lean additive — fan, chunky gear, twisted-
 * tube heat exchanger, universal joint, living-hinge case, spring on
 * its seats. Simple enough to read as
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
  | "joint"
  | "hinge"
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

function roundedRectShape(w: number, h: number, r: number) {
  const shape = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x0 + w - r, y0);
  shape.absarc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x0 + w, y0 + h - r);
  shape.absarc(x0 + w - r, y0 + h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x0 + r, y0 + h);
  shape.absarc(x0 + r, y0 + h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + r);
  shape.absarc(x0 + r, y0 + r, r, Math.PI, (Math.PI * 3) / 2, false);
  return shape;
}

/** A rounded tray (floor + wall ring) of `depth`, open on +Z. */
function tray(w: number, h: number, r: number, depth: number, wall: number) {
  const floor = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: wall,
    bevelEnabled: false,
    curveSegments: 8,
  });
  const ring = roundedRectShape(w, h, r);
  const inner = new THREE.Path();
  inner.setFromPoints(roundedRectShape(w - wall * 2, h - wall * 2, Math.max(r - wall, 0.01)).getPoints(8));
  ring.holes.push(inner);
  const walls = new THREE.ExtrudeGeometry(ring, {
    depth: depth - wall,
    bevelEnabled: false,
    curveSegments: 8,
  });
  walls.translate(0, 0, wall);
  return mergeGeometries([floor, walls]);
}

/**
 * Twisted-tube heat exchanger: three tubes braided around each other
 * between two square headers, with a port on each header. The braid is
 * what a bent-tube build can't do — and the turbulence it causes is the
 * point.
 */
export function makeExchangerGeometry({ tubes = 3, turns = 1.25 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const span = 0.84;
  const header = 0.32;
  for (const sx of [-1, 1]) {
    const h = new THREE.ExtrudeGeometry(roundedRectShape(header, header, 0.06), {
      depth: 0.08,
      bevelEnabled: false,
      curveSegments: 8,
    });
    h.rotateY(Math.PI / 2);
    h.translate(sx * (span / 2) + (sx > 0 ? 0 : -0.08), 0, 0);
    parts.push(h);
    const port = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 24);
    port.rotateZ(Math.PI / 2);
    port.translate(sx * (span / 2 + 0.14), 0, 0);
    parts.push(port);
    const portFlange = new THREE.CylinderGeometry(0.08, 0.08, 0.03, 32);
    portFlange.rotateZ(Math.PI / 2);
    portFlange.translate(sx * (span / 2 + 0.2), 0, 0);
    parts.push(portFlange);
  }
  for (let i = 0; i < tubes; i++) {
    const phase = (i / tubes) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 64; s++) {
      const t = s / 64;
      const a = phase + t * turns * Math.PI * 2;
      // Braid radius eases in from the header so each tube meets it square.
      const r = 0.085 * Math.sin(t * Math.PI) ** 0.35;
      pts.push(new THREE.Vector3(-span / 2 + t * span, Math.cos(a) * r, Math.sin(a) * r));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.042, 16, false));
  }
  return finish(mergeGeometries(parts));
}

/**
 * Living-hinge case: a rounded tray and its lid printed as one piece,
 * joined by a thin flexing strip instead of pins — a hinge that only
 * exists because the plastic is printed thin. Shown propped open, with
 * a snap tab on the lid.
 */
export function makeLivingHingeGeometry({ open = 2.1 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const w = 0.9;
  const d = 0.56;
  const r = 0.1;
  const base = tray(w, d, r, 0.2, 0.04);
  base.rotateX(-Math.PI / 2);
  parts.push(base);
  const hingeZ = -d / 2;
  // Lid: shallower tray, hinged at the back edge, swung open.
  const lid = tray(w, d, r, 0.09, 0.04);
  lid.rotateX(-Math.PI / 2);
  lid.scale(1, -1, 1);
  const tab = new THREE.BoxGeometry(0.18, 0.06, 0.03);
  tab.translate(0, -0.06, d / 2 + 0.015);
  const lidGroup = mergeGeometries([lid, tab]);
  lidGroup.translate(0, 0, -hingeZ);
  lidGroup.rotateX(-open);
  lidGroup.translate(0, 0.2, hingeZ);
  parts.push(lidGroup);
  // The flexure itself: a thin strip bridging base and lid.
  const strip = new THREE.CylinderGeometry(0.03, 0.03, w * 0.86, 24, 1, false, 0, Math.PI);
  strip.rotateZ(Math.PI / 2);
  strip.translate(0, 0.2, hingeZ - 0.005);
  parts.push(strip);
  return finish(mergeGeometries(parts));
}

/**
 * Universal joint: two forked yokes on their shafts, coupled by a
 * cross-shaped spider, the upper shaft broken out at an angle. Print it
 * assembled and it articulates off the bed.
 */
export function makeJointGeometry({ angle = 0.45 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const yoke = (out: THREE.BufferGeometry[]) => {
    const shaft = new THREE.CylinderGeometry(0.075, 0.075, 0.42, 32);
    shaft.translate(0, -0.37, 0);
    const hub = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 40);
    hub.translate(0, -0.2, 0);
    const ear = new THREE.Shape();
    ear.moveTo(-0.07, -0.16);
    ear.lineTo(0.07, -0.16);
    ear.lineTo(0.07, 0);
    ear.absarc(0, 0, 0.07, 0, Math.PI, false);
    ear.closePath();
    ear.holes.push(circlePath(0.03));
    const ears = [-1, 1].map((sx) => {
      const g = new THREE.ExtrudeGeometry(ear, { depth: 0.05, bevelEnabled: false, curveSegments: 20 });
      g.rotateY(Math.PI / 2);
      g.translate(sx > 0 ? 0.12 : -0.17, 0, 0);
      return g;
    });
    out.push(shaft, hub, ...ears);
  };
  const lower: THREE.BufferGeometry[] = [];
  yoke(lower);
  parts.push(mergeGeometries(lower));
  const upperParts: THREE.BufferGeometry[] = [];
  yoke(upperParts);
  const upper = mergeGeometries(upperParts);
  upper.rotateX(Math.PI);
  upper.rotateY(Math.PI / 2);
  upper.rotateZ(angle);
  parts.push(upper);
  // Spider: a block with four trunnion arms.
  parts.push(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  const armX = new THREE.CylinderGeometry(0.028, 0.028, 0.36, 16);
  armX.rotateZ(Math.PI / 2);
  parts.push(armX);
  const armZ = new THREE.CylinderGeometry(0.028, 0.028, 0.36, 16);
  armZ.rotateX(Math.PI / 2);
  armZ.rotateY(0);
  armZ.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
  parts.push(armZ);
  return finish(mergeGeometries(parts));
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
  exchanger: () => makeExchangerGeometry(),
  joint: () => makeJointGeometry(),
  hinge: () => makeLivingHingeGeometry(),
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
