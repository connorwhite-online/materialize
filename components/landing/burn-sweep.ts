import * as THREE from "three";
import {
  LANDING_MATERIALS,
  wrapIndex,
  type LandingMaterial,
} from "./landing-materials";

/**
 * The "burn" material change: a thin electric-blue band climbs the
 * enclosure bottom → top, and the new material is left behind it — like
 * a Jacob's ladder re-skinning the part.
 *
 * Built from clipping planes, not a custom shader, so it works with every
 * material (resin's transmission included) and the baked AO. Each shell is
 * drawn as up to three layers sharing one geometry:
 *
 *   a    — the current material, clipped to ABOVE the line
 *   b    — the incoming material, clipped to BELOW the line
 *   band — additive blue, clipped to a thin slab ON the line
 *
 * Between sweeps only `a` draws, unclipped, so the effect costs nothing
 * while idle.
 */

/** Seconds for the band to climb the whole device. */
export const SWEEP_S = 0.9;
/** On the first step, a new sweep starts every CYCLE_S seconds. */
export const CYCLE_S = 2;
/** Every step except the first shows the plain white plastic. */
export const PLAIN = 0;

/**
 * What to sweep to next, or null to hold. Pure, so the schedule is
 * testable without a GPU.
 *
 * - Never interrupts a sweep in flight.
 * - Off the first step: one sweep back to the plain plastic, then hold.
 * - On the first step: advance through every family, one per CYCLE_S.
 */
export function nextSweep(
  step: number,
  current: number,
  sinceLastSweep: number,
  sweeping: boolean,
): number | null {
  if (sweeping) return null;
  if (step !== 0) return current === PLAIN ? null : PLAIN;
  if (sinceLastSweep >= CYCLE_S) return wrapIndex(current + 1);
  return null;
}

/** Smooth, slightly front-loaded climb: quick off the bottom, eases into the top. */
export function sweepEase(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 2.2);
}

// ─── three.js layers ──────────────────────────────────────────────────

export interface ShellLayers {
  a: THREE.Mesh;
  b: THREE.Mesh;
  band: THREE.Mesh;
  matA: THREE.MeshPhysicalMaterial;
  matB: THREE.MeshPhysicalMaterial;
  bandMat: THREE.MeshBasicMaterial;
  /** Keep-below / keep-above planes, updated in place each frame. */
  below: THREE.Plane;
  above: THREE.Plane;
  bandLow: THREE.Plane;
  bandHigh: THREE.Plane;
}

/** Plane the line sits on: world y = h. Normal points to the KEPT side. */
const keepBelow = () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const keepAbove = () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function shellMaterial(ao: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    clearcoatRoughness: 0.12,
    aoMap: ao,
    aoMapIntensity: 1.3,
  });
}

/**
 * Turn a shell mesh into its three layers. `mesh` becomes layer `a`; the
 * other two are siblings sharing its geometry and transform.
 */
export function makeShellLayers(
  mesh: THREE.Mesh,
  ao: THREE.Texture,
): ShellLayers {
  const below = keepBelow();
  const above = keepAbove();
  const bandLow = keepAbove();
  const bandHigh = keepBelow();

  const matA = shellMaterial(ao);
  const matB = shellMaterial(ao);
  matB.clippingPlanes = [below];
  const bandMat = new THREE.MeshBasicMaterial({
    color: "#8fbcff",
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Sits exactly on the shell's own surface; win the depth tie.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    clippingPlanes: [bandLow, bandHigh],
    toneMapped: false,
  });

  mesh.material = matA;
  const b = new THREE.Mesh(mesh.geometry, matB);
  const band = new THREE.Mesh(mesh.geometry, bandMat);
  for (const layer of [b, band]) {
    layer.position.copy(mesh.position);
    layer.quaternion.copy(mesh.quaternion);
    layer.scale.copy(mesh.scale);
    layer.visible = false;
    mesh.parent?.add(layer);
  }
  band.renderOrder = 2;
  return {
    a: mesh,
    b,
    band,
    matA,
    matB,
    bandMat,
    below,
    above,
    bandLow,
    bandHigh,
  };
}

export function applyLook(
  m: THREE.MeshPhysicalMaterial,
  look: LandingMaterial,
) {
  m.color.set(look.color);
  m.metalness = look.metalness;
  m.roughness = look.roughness;
  m.clearcoat = look.clearcoat ?? 0;
  // Exactly 0 when not glass: any transmission > 0 costs an extra pass.
  m.transmission = look.transmission ?? 0;
  m.ior = look.ior ?? 1.5;
  m.thickness = look.thickness ?? 0;
}

/** Begin a sweep on one shell: `b` takes the incoming look. */
export function startSweep(l: ShellLayers, to: number) {
  applyLook(l.matB, LANDING_MATERIALS[to]);
  l.matA.clippingPlanes = [l.above];
  l.b.visible = true;
  l.band.visible = true;
}

/**
 * Place the line at world height `h`. `width` is the band's half-height;
 * `glow` its brightness (the caller flickers it).
 */
export function setSweepLine(
  l: ShellLayers,
  h: number,
  width: number,
  glow: number,
) {
  l.below.constant = h; // keep y <= h  (−y + h ≥ 0)
  l.above.constant = -h; // keep y >= h
  l.bandLow.constant = -(h - width);
  l.bandHigh.constant = h + width;
  l.bandMat.opacity = glow;
}

/** Finish: the incoming look becomes the resting one, extra layers hide. */
export function endSweep(l: ShellLayers, to: number) {
  applyLook(l.matA, LANDING_MATERIALS[to]);
  l.matA.clippingPlanes = null;
  l.b.visible = false;
  l.band.visible = false;
}
