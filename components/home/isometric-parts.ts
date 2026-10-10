import * as THREE from "three";

/**
 * Parts for the authed-home dropzone backdrop: components from a
 * machine that could only be built additively — a regeneratively
 * cooled thruster with its coolant line wound around the bell, a
 * closed impeller whose vanes sit sealed under a shroud, and a
 * manifold whose channels branch in smooth curves instead of
 * cross-drilled bores. Each would take a multi-part assembly (or not
 * be makeable at all) any other way.
 *
 * Each builder returns a BufferGeometry with largest extent 1, centred
 * on the origin, so the scene can place them by fraction of the
 * canvas. Curved surfaces are tessellated finely enough that facet
 * edges stay under the drawing's crease angle and draw as silhouettes
 * only. Pure three.js, no React: unit-tested without a canvas.
 */

export type IsometricPartKind = "thruster" | "impeller" | "manifold";

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

/** Orient a +Y-axis geometry along `dir` and move it to `at`. */
function placeAlong(geo: THREE.BufferGeometry, dir: THREE.Vector3, at: THREE.Vector3) {
  geo.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  );
  geo.translate(at.x, at.y, at.z);
  return geo;
}

/**
 * Bell radius of the thruster at height y (exit at y = 0, throat at
 * y = 0.5). Shared by the lathe profile and the coolant helix so the
 * line hugs the wall.
 */
function bellRadius(y: number) {
  const t = 1 - y / 0.5;
  return 0.11 + 0.25 * t ** 1.6;
}

/**
 * Regeneratively cooled thruster: injector flange, combustion chamber,
 * throat, bell — with the coolant line wound around the bell as one
 * continuous helix into a ring manifold at the exit.
 */
export function makeThrusterGeometry() {
  const profile: [number, number][] = [[0, 1.02], [0.3, 1.02], [0.3, 0.96], [0.22, 0.96], [0.22, 0.72]];
  // Converging section into the throat.
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    profile.push([0.22 - 0.11 * (1 - Math.cos((t * Math.PI) / 2)) ** 0.8, 0.72 - 0.22 * t]);
  }
  for (let i = 1; i <= 24; i++) {
    const y = 0.5 - (0.5 * i) / 24;
    profile.push([bellRadius(y), y]);
  }
  profile.push([bellRadius(0) + 0.015, 0]);
  // Lip, then back up the inside wall: an open bell, not a capped one.
  profile.push([0.375, 0], [0.35, 0.005]);
  for (let i = 1; i <= 24; i++) {
    const y = (0.5 * i) / 24;
    profile.push([bellRadius(y) - 0.02, y]);
  }
  profile.push([0, 0.5]);
  const lathe = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    64
  );

  const tube = 0.014;
  const turns = 2.5;
  const helix: THREE.Vector3[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const y = 0.06 + 0.42 * t;
    const r = bellRadius(y) + tube;
    const a = t * turns * Math.PI * 2;
    helix.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 240, tube, 16, false);

  const ring = new THREE.TorusGeometry(bellRadius(0.04) + tube * 1.6, tube * 1.8, 16, 72);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.04, 0);

  // Lie it on its side, bell toward the viewer's right, so the drawing
  // shows the chamber-throat-bell profile rather than the flange face.
  const merged = mergeGeometries([lathe, coil, ring]);
  merged.rotateZ(Math.PI / 2);
  return finish(merged);
}

/**
 * Closed impeller: back disk, hub, eight swept vanes and a shroud over
 * them. The sealed vane passages are what a mill can't reach.
 */
export function makeImpellerGeometry({ vanes = 8 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const disk = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 72);
  disk.translate(0, 0.03, 0);
  parts.push(disk);

  const hub = new THREE.LatheGeometry(
    [
      [0, 0.42],
      [0.06, 0.42],
      [0.08, 0.38],
      [0.11, 0.24],
      [0.18, 0.08],
      [0.2, 0.06],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    48
  );
  parts.push(hub);

  // Shroud: a cone-ish annulus leaving the inlet eye open.
  const shroud = new THREE.LatheGeometry(
    [
      [0.5, 0.2],
      [0.5, 0.24],
      [0.3, 0.32],
      [0.27, 0.34],
      [0.25, 0.3],
      [0.48, 0.2],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    72
  );
  parts.push(shroud);

  // Vanes: thin backward-swept strips between disk and shroud.
  const vane = new THREE.Shape();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = 0.2 + 0.29 * t;
    const a = -0.9 * t;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  vane.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) vane.lineTo(p.x, p.y);
  for (const p of pts.slice().reverse()) {
    const n = p.clone().normalize().rotateAround(new THREE.Vector2(), Math.PI / 2);
    vane.lineTo(p.x + n.x * 0.025, p.y + n.y * 0.025);
  }
  vane.closePath();
  for (let i = 0; i < vanes; i++) {
    const geo = new THREE.ExtrudeGeometry(vane, { depth: 0.16, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.06, 0);
    geo.rotateY((i / vanes) * Math.PI * 2);
    parts.push(geo);
  }
  return finish(mergeGeometries(parts));
}

/**
 * Branching manifold: one flanged inlet whose channel splits three
 * ways in smooth curves, each branch ending in its own flange. The
 * curved, junction-free internal flow path is the additive tell.
 */
export function makeManifoldGeometry({ pipe = 0.075 } = {}) {
  const parts: THREE.BufferGeometry[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const flange = (curve: THREE.Curve<THREE.Vector3>, t: 0 | 1) => {
    const at = curve.getPoint(t);
    const dir = curve.getTangent(t);
    const ring = new THREE.CylinderGeometry(pipe * 1.5, pipe * 1.5, 0.04, 40);
    return placeAlong(ring, dir, at);
  };
  const trunk = new THREE.CatmullRomCurve3([v(0, 0, -0.55), v(0, 0.02, -0.3), v(0, 0.1, -0.08), v(0, 0.2, 0.05)]);
  parts.push(new THREE.TubeGeometry(trunk, 48, pipe, 20, false), flange(trunk, 0));
  // Branches fan out and turn upward, so each end flange shows as an
  // ellipse from above rather than a disc facing the viewer.
  const ends = [v(-0.42, 0.62, 0.12), v(0.02, 0.72, 0.3), v(0.42, 0.6, 0.12)];
  for (const end of ends) {
    const branch = new THREE.CatmullRomCurve3([
      v(0, 0.2, 0.05),
      v(end.x * 0.45, 0.26, 0.05 + end.z * 0.4),
      v(end.x * 0.95, end.y - 0.2, end.z),
      end,
    ]);
    parts.push(new THREE.TubeGeometry(branch, 48, pipe * 0.82, 20, false), flange(branch, 1));
  }
  // A junction body so the split reads as one cast-in node.
  const node = new THREE.SphereGeometry(pipe * 1.35, 32, 20);
  node.translate(0, 0.2, 0.05);
  parts.push(node);
  return finish(mergeGeometries(parts));
}

export const PART_BUILDERS: Record<
  IsometricPartKind,
  () => THREE.BufferGeometry
> = {
  thruster: () => makeThrusterGeometry(),
  impeller: () => makeImpellerGeometry(),
  manifold: () => makeManifoldGeometry(),
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
