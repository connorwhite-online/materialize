import * as THREE from "three";

/**
 * Equilateral triangle in XY, pointing +Y, with circular fillets at
 * each corner. Used as the extrude profile for the dropzone's chunky
 * rounded-triangle primitive.
 */
export function roundedTriangleShape(
  side = 1.18,
  cornerRadius = 0.26
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
    shape.absarc(center.x, center.y, cornerRadius, a0, a1, false);
  }

  shape.closePath();
  return shape;
}

/**
 * Chunky rounded triangle — an extruded, bevelled token. Sits in XY
 * facing the camera (same plane as a play-button glyph) with enough
 * thickness that a slow tumble still reads as 3D.
 */
export function makeRoundedTriangleGeometry(): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(roundedTriangleShape(), {
    depth: 0.32,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.1,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}
