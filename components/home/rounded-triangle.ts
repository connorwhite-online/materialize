import * as THREE from "three";

/**
 * Equilateral triangle in XY, pointing +Y. The fillet is a small
 * bite off each vertex so the sides stay long and straight — a
 * literal triangle with rounded corners, not a Reuleaux blob.
 */
export const ROUNDED_TRIANGLE_SIDE = 1.32;
export const ROUNDED_TRIANGLE_CORNER_RADIUS = 0.11;

export function roundedTriangleShape(
  side = ROUNDED_TRIANGLE_SIDE,
  cornerRadius = ROUNDED_TRIANGLE_CORNER_RADIUS
): THREE.Shape {
  const h = (side * Math.sqrt(3)) / 2;
  const verts = [
    new THREE.Vector2(0, (2 * h) / 3),
    new THREE.Vector2(side / 2, -h / 3),
    new THREE.Vector2(-side / 2, -h / 3),
  ];

  const shape = new THREE.Shape();
  const n = verts.length;

  for (let i = 0; i < n; i++) {
    const prev = verts[(i + n - 1) % n]!;
    const curr = verts[i]!;
    const next = verts[(i + 1) % n]!;

    const toPrev = prev.clone().sub(curr).normalize();
    const toNext = next.clone().sub(curr).normalize();
    const interior = Math.acos(
      THREE.MathUtils.clamp(toPrev.dot(toNext), -1, 1)
    );
    const offset = cornerRadius / Math.tan(interior / 2);
    const pStart = curr.clone().addScaledVector(toPrev, offset);
    const pEnd = curr.clone().addScaledVector(toNext, offset);

    const bisect = toPrev.clone().add(toNext).normalize();
    const center = curr
      .clone()
      .addScaledVector(bisect, cornerRadius / Math.sin(interior / 2));
    const a0 = Math.atan2(pStart.y - center.y, pStart.x - center.x);
    const a1 = Math.atan2(pEnd.y - center.y, pEnd.x - center.x);

    if (i === 0) shape.moveTo(pStart.x, pStart.y);
    else shape.lineTo(pStart.x, pStart.y);
    // Convex CCW outline: a0→a1 CCW is the long interior sweep (a
    // circular lobe). Clockwise is the short outward fillet.
    shape.absarc(center.x, center.y, cornerRadius, a0, a1, true);
  }

  shape.closePath();
  return shape;
}

/**
 * Extruded triangle token. A small bevel rounds the rim (the
 * edges) without eating the silhouette the way a chunky bevel does.
 */
export function makeRoundedTriangleGeometry(): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(roundedTriangleShape(), {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 20,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}
