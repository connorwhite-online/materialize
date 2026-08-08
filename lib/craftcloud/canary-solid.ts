/**
 * The synthetic model the upload canary sends to CraftCloud.
 *
 * Generated rather than committed as a fixture: it is 284 bytes of
 * pure arithmetic, and a generated solid can't drift from the code
 * that describes it or go missing from a deploy.
 *
 * It is a real closed tetrahedron, not a single throwaway triangle.
 * A degenerate or non-manifold mesh risks CraftCloud rejecting it on
 * geometric grounds, and a canary that alerts because its own test
 * file is bad is worse than no canary — every alert has to mean "the
 * pipeline is broken".
 *
 * Binary STL layout:
 *   80 bytes  header (free-form)
 *    4 bytes  uint32 LE triangle count
 *   50 bytes  per triangle: 12 float32 LE (normal, v1, v2, v3)
 *                           + uint16 attribute byte count
 */

type Vec3 = readonly [number, number, number];

// A 10mm-ish regular tetrahedron. Small enough to be trivial to
// process, large enough to be a plausible printable part.
const A: Vec3 = [0, 0, 0];
const B: Vec3 = [10, 0, 0];
const C: Vec3 = [5, 8.66, 0];
const D: Vec3 = [5, 2.887, 8.165];

/** Faces wound counter-clockwise seen from outside, per the STL convention. */
const FACES: ReadonlyArray<readonly [Vec3, Vec3, Vec3]> = [
  [A, C, B], // base, normal points down
  [A, B, D],
  [B, C, D],
  [C, A, D],
];

function subtract(p: Vec3, q: Vec3): Vec3 {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}

function cross(p: Vec3, q: Vec3): Vec3 {
  return [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ];
}

/**
 * Unit normal from the face winding. Some parsers recompute normals
 * and tolerate zeros, but not all do — writing real ones keeps the
 * file valid against the strictest reader.
 */
function normalOf(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const n = cross(subtract(v2, v1), subtract(v3, v1));
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length === 0) return [0, 0, 0];
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Deterministic binary STL of the canary tetrahedron. */
export function buildCanarySolid(): Uint8Array {
  const HEADER_BYTES = 80;
  const COUNT_BYTES = 4;
  const TRIANGLE_BYTES = 50;

  const buffer = new ArrayBuffer(
    HEADER_BYTES + COUNT_BYTES + FACES.length * TRIANGLE_BYTES
  );
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header. Left as an identifying marker so the file is recognisable
  // if it ever turns up somewhere unexpected.
  const header = "materialize upload canary — synthetic tetrahedron";
  for (let i = 0; i < header.length && i < HEADER_BYTES; i++) {
    bytes[i] = header.charCodeAt(i) & 0x7f;
  }

  view.setUint32(HEADER_BYTES, FACES.length, true);

  let offset = HEADER_BYTES + COUNT_BYTES;
  for (const [v1, v2, v3] of FACES) {
    for (const value of [...normalOf(v1, v2, v3), ...v1, ...v2, ...v3]) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true); // attribute byte count
    offset += 2;
  }

  return bytes;
}

export const CANARY_FILENAME = "materialize-canary.stl";
