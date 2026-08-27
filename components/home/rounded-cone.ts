import * as THREE from "three";

/**
 * Profile for a chunky rounded cone (lathed around Y): spherical cap,
 * taper, filleted base. x is radius, y is height; x must stay ≥ 0.
 */
export function roundedConeProfile(): THREE.Vector2[] {
  const height = 1.28;
  const radius = 0.52;
  const tipR = 0.22;
  const baseFillet = 0.12;
  const points: THREE.Vector2[] = [];

  const top = height / 2;
  const bot = -height / 2;
  const tipCenterY = top - tipR;
  // Past 90° so the cap meets a steep taper instead of a cylinder.
  const tipArc = Math.PI * 0.62;

  const tipSteps = 12;
  for (let i = 0; i <= tipSteps; i++) {
    const a = (i / tipSteps) * tipArc;
    points.push(
      new THREE.Vector2(
        Math.max(1e-4, tipR * Math.sin(a)),
        tipCenterY + tipR * Math.cos(a)
      )
    );
  }

  const taperStart = points[points.length - 1]!;
  const taperEnd = new THREE.Vector2(radius, bot + baseFillet);
  const taperSteps = 10;
  for (let i = 1; i <= taperSteps; i++) {
    const t = i / taperSteps;
    points.push(
      new THREE.Vector2(
        taperStart.x + (taperEnd.x - taperStart.x) * t,
        taperStart.y + (taperEnd.y - taperStart.y) * t
      )
    );
  }

  const filletSteps = 10;
  for (let i = 1; i <= filletSteps; i++) {
    const t = i / filletSteps;
    const a = t * (Math.PI / 2);
    points.push(
      new THREE.Vector2(
        Math.max(1e-4, radius - baseFillet + baseFillet * Math.cos(a)),
        bot + baseFillet - baseFillet * Math.sin(a)
      )
    );
  }

  points.push(new THREE.Vector2(1e-4, bot));
  return points;
}

export function makeRoundedConeGeometry(): THREE.LatheGeometry {
  // Lathe winds the profile as given. Tip→base (decreasing Y) produces
  // inward normals, which culls the FrontSide fill and leaves only the
  // BackSide ink hull — a solid black blob. Reverse so normals point out.
  const geometry = new THREE.LatheGeometry(
    [...roundedConeProfile()].reverse(),
    48
  );
  geometry.computeVertexNormals();
  return geometry;
}
