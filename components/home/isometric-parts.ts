import * as THREE from "three";

/**
 * Parts for the authed-home dropzone backdrop: a playful bench of
 * machine components that lean additive — fan, chunky gear, twisted-
 * tube heat exchanger, clevis yoke, compliant flexure stage, spring on
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
  | "flexure"
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
 * Compliant flexure stage: one solid frame whose centre shuttle hangs
 * on two pairs of thin parallel leaf springs. It moves without a single
 * joint or fastener — a mechanism that exists because it's printed as
 * one piece.
 */
export function makeFlexureGeometry({ thickness = 0.16 } = {}) {
  const w = 1;
  const h = 0.66;
  const bar = 0.1;
  const frame = roundedRectShape(w, h, 0.08);
  const opening = new THREE.Path();
  opening.setFromPoints(roundedRectShape(w - bar * 2, h - bar * 2, 0.03).getPoints(6));
  frame.holes.push(opening);
  // Mounting holes in the frame corners.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      frame.holes.push(circlePath(0.025, sx * (w / 2 - bar / 2), sy * (h / 2 - bar / 2)));
    }
  }
  const extrude = (shape: THREE.Shape, depth = thickness) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 16 });
  const parts: THREE.BufferGeometry[] = [extrude(frame)];

  // Shuttle: a block in the middle with a bore.
  const shuttle = roundedRectShape(0.22, 0.2, 0.03);
  shuttle.holes.push(circlePath(0.045));
  parts.push(extrude(shuttle));

  // Leaf springs: thin beams from the shuttle out to the frame's sides,
  // a pair above and a pair below, so the shuttle slides straight.
  const inner = w / 2 - bar;
  for (const y of [-0.075, 0.075, -0.17, 0.17]) {
    if (Math.abs(y) > h / 2 - bar - 0.012) continue;
    const beam = new THREE.Shape();
    beam.moveTo(-inner - 0.005, y - 0.009);
    beam.lineTo(inner + 0.005, y - 0.009);
    beam.lineTo(inner + 0.005, y + 0.009);
    beam.lineTo(-inner - 0.005, y + 0.009);
    beam.closePath();
    parts.push(extrude(beam, thickness * 0.7));
  }
  const merged = mergeGeometries(parts);
  merged.rotateX(-Math.PI / 2);
  return finish(merged);
}

/**
 * Clevis yoke: the forked end of an articulating joint on its shaft —
 * two ears with a cross-bored pin and a hub, the part a linkage or
 * actuator pivots on.
 */
export function makeJointGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const shaft = new THREE.CylinderGeometry(0.11, 0.11, 0.5, 40);
  shaft.translate(0, -0.47, 0);
  const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.12, 48);
  hub.translate(0, -0.18, 0);
  parts.push(shaft, hub);
  const ear = new THREE.Shape();
  ear.moveTo(-0.12, -0.18);
  ear.lineTo(0.12, -0.18);
  ear.lineTo(0.12, 0.06);
  ear.absarc(0, 0.06, 0.12, 0, Math.PI, false);
  ear.closePath();
  ear.holes.push(circlePath(0.05, 0, 0.06));
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(ear, { depth: 0.07, bevelEnabled: false, curveSegments: 24 });
    g.rotateY(Math.PI / 2);
    g.translate(sx > 0 ? 0.12 : -0.19, 0, 0);
    parts.push(g);
  }
  // The pin, through both ears, with a head on one side.
  const pin = new THREE.CylinderGeometry(0.035, 0.035, 0.48, 20);
  pin.rotateZ(Math.PI / 2);
  pin.translate(0, 0.06, 0);
  const head = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24);
  head.rotateZ(Math.PI / 2);
  head.translate(0.26, 0.06, 0);
  parts.push(pin, head);
  const merged = mergeGeometries(parts);
  merged.rotateZ(-0.25);
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
  exchanger: () => makeExchangerGeometry(),
  joint: () => makeJointGeometry(),
  flexure: () => makeFlexureGeometry(),
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
