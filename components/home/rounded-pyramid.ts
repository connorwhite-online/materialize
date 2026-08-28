import * as THREE from "three";

/**
 * Chubby square-pyramid constants. The base is a rounded square; a
 * generous bevel + incomplete taper (tipScale > 0) keep the tip and
 * ridges soft so it matches the rounded stainless cube.
 */
export const ROUNDED_PYRAMID_BASE = 1.15;
export const ROUNDED_PYRAMID_CORNER_RADIUS = 0.28;
export const ROUNDED_PYRAMID_HEIGHT = 0.95;
/** How small the tip stays relative to the base — 0 would be a knife tip. */
export const ROUNDED_PYRAMID_TIP_SCALE = 0.14;
export const ROUNDED_PYRAMID_BEVEL = 0.08;

/** Rounded square in XY, centred on the origin. */
export function roundedSquareShape(
  size = ROUNDED_PYRAMID_BASE,
  cornerRadius = ROUNDED_PYRAMID_CORNER_RADIUS
): THREE.Shape {
  const half = size / 2;
  const r = Math.min(cornerRadius, half * 0.9);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  shape.closePath();
  return shape;
}

/**
 * Chubby square pyramid: extrude a rounded square with a soft bevel,
 * then taper toward a blunt tip and tip it upright (+Y).
 */
export function makeRoundedPyramidGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(roundedSquareShape(), {
    depth: ROUNDED_PYRAMID_HEIGHT,
    bevelEnabled: true,
    bevelThickness: ROUNDED_PYRAMID_BEVEL,
    bevelSize: ROUNDED_PYRAMID_BEVEL,
    bevelSegments: 4,
    curveSegments: 12,
    steps: 1,
  });

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const z0 = box.min.z;
  const z1 = box.max.z;
  const span = z1 - z0 || 1;

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    // 0 at the base face, 1 at the tip face of the extrusion.
    const t = (z - z0) / span;
    const scale =
      1 - t * (1 - ROUNDED_PYRAMID_TIP_SCALE);
    pos.setX(i, pos.getX(i) * scale);
    pos.setY(i, pos.getY(i) * scale);
  }
  pos.needsUpdate = true;

  // Extrude grows in +Z; tip that toward +Y so it sits like a pyramid.
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}
