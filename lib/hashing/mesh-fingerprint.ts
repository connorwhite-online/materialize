// No `server-only` here — pure hashing logic, no env reads. The Node
// `crypto` import already prevents bundler-side use from a client
// component. Letting Node scripts (e.g. the backfill in
// scripts/backfill-mesh-fingerprint.ts) import it directly.
import { createHash } from "node:crypto";

// Geometry hash version — bump whenever the normalization rules below
// change, so old rows can be backfilled instead of mixing schemes
// silently in the same index.
export const GEOMETRY_HASH_VERSION = 1;

const PARSEABLE_FORMATS = new Set(["stl", "obj"]);

export type MeshFormat = "stl" | "obj" | "3mf" | "step" | "amf";

export type MeshFingerprint = {
  byteHash: string;
  geometryHash: string | null;
  geometryHashVersion: number | null;
  coarseFingerprint: string | null;
  volumeUm3: number | null;
  triangleCount: number | null;
  bboxXUm: number | null;
  bboxYUm: number | null;
  bboxZUm: number | null;
};

export function emptyFingerprint(byteHash: string): MeshFingerprint {
  return {
    byteHash,
    geometryHash: null,
    geometryHashVersion: null,
    coarseFingerprint: null,
    volumeUm3: null,
    triangleCount: null,
    bboxXUm: null,
    bboxYUm: null,
    bboxZUm: null,
  };
}

// Streaming SHA-256 + buffered geometry parse. We have to buffer the
// raw bytes regardless because the parsers are not streamable, but we
// still feed `crypto.createHash` chunk-by-chunk for byte-hash purposes
// — that lets us return the byte-hash even when the parse fails.
export async function fingerprintFromStream(
  stream: ReadableStream<Uint8Array>,
  format: MeshFormat,
  unit: "mm" | "cm" | "in"
): Promise<MeshFingerprint> {
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    chunks.push(value);
    total += value.byteLength;
  }
  const byteHash = hash.digest("hex");

  if (!PARSEABLE_FORMATS.has(format)) return emptyFingerprint(byteHash);

  // Concat all chunks into one buffer for the parsers.
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }

  let triangles: Float64Array | null = null;
  try {
    if (format === "stl") triangles = parseStl(buf);
    else if (format === "obj") triangles = parseObj(buf);
  } catch {
    triangles = null;
  }
  if (!triangles || triangles.length === 0) return emptyFingerprint(byteHash);

  return computeFingerprintFromTriangles(byteHash, triangles, unit);
}

// Test seam: callers with already-parsed triangles (e.g. a future
// 3mf/amf parser, or unit tests) can skip the IO/parse and feed the
// raw triangle list directly.
export function computeFingerprintFromTriangles(
  byteHash: string,
  triangles: Float64Array,
  unit: "mm" | "cm" | "in"
): MeshFingerprint {
  // Convert input units to mm so the coarse stats are comparable
  // across files declared in different units.
  const unitToMm = unit === "mm" ? 1 : unit === "cm" ? 10 : 25.4;
  if (unitToMm !== 1) {
    for (let i = 0; i < triangles.length; i++) triangles[i] *= unitToMm;
  }

  const triCount = triangles.length / 9;

  // Bounding box in mm.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const bx = maxX - minX, by = maxY - minY, bz = maxZ - minZ;

  // Signed volume via tetrahedral sum (Zhang-Chen). Magnitude only —
  // sign depends on triangle winding which we don't trust.
  let vol6 = 0;
  for (let i = 0; i < triangles.length; i += 9) {
    const ax = triangles[i],     ay = triangles[i + 1], az = triangles[i + 2];
    const bxv = triangles[i + 3], byv = triangles[i + 4], bzv = triangles[i + 5];
    const cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];
    vol6 +=
      ax * (byv * cz - bzv * cy) +
      ay * (bzv * cx - bxv * cz) +
      az * (bxv * cy - byv * cx);
  }
  const volumeMm3 = Math.abs(vol6) / 6;

  // Coarse fingerprint at integer-micrometer precision.
  const volumeUm3 = Math.round(volumeMm3 * 1e9);
  const bboxXUm = Math.round(bx * 1000);
  const bboxYUm = Math.round(by * 1000);
  const bboxZUm = Math.round(bz * 1000);
  const coarseFingerprint = createHash("sha256")
    .update(
      `v${volumeUm3}|t${triCount}|x${bboxXUm}|y${bboxYUm}|z${bboxZUm}`
    )
    .digest("hex");

  // Normalized geometry hash. Translate so bbox-min sits at origin,
  // scale so longest dim = 1, round to 1e-6 (≈1µm relative). Sort
  // vertices within each triangle and then sort all triangles, so
  // identical geometry hashes regardless of vertex/triangle ordering
  // and identical regardless of uniform scale — catches the
  // mm-vs-inch and "exported with different transform" cases.
  const longest = Math.max(bx, by, bz);
  const inv = longest > 0 ? 1 / longest : 1;
  // 12 bytes per triangle vertex coord in fixed-point i32 form;
  // 9 coords per triangle = 36 bytes per triangle.
  const triBytes = new Uint8Array(triCount * 36);
  const dv = new DataView(triBytes.buffer);
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    // Pull 3 vertices.
    const verts: [number, number, number][] = [
      [
        Math.round((triangles[base    ] - minX) * inv * 1e6),
        Math.round((triangles[base + 1] - minY) * inv * 1e6),
        Math.round((triangles[base + 2] - minZ) * inv * 1e6),
      ],
      [
        Math.round((triangles[base + 3] - minX) * inv * 1e6),
        Math.round((triangles[base + 4] - minY) * inv * 1e6),
        Math.round((triangles[base + 5] - minZ) * inv * 1e6),
      ],
      [
        Math.round((triangles[base + 6] - minX) * inv * 1e6),
        Math.round((triangles[base + 7] - minY) * inv * 1e6),
        Math.round((triangles[base + 8] - minZ) * inv * 1e6),
      ],
    ];
    // Sort the three vertices lexicographically — drops winding info
    // intentionally. We're matching geometry, not orientation.
    verts.sort(compareVec3);
    const off = t * 36;
    for (let v = 0; v < 3; v++) {
      const [x, y, z] = verts[v];
      dv.setInt32(off + v * 12,     x, true);
      dv.setInt32(off + v * 12 + 4, y, true);
      dv.setInt32(off + v * 12 + 8, z, true);
    }
  }

  // Sort triangles lexicographically as 36-byte chunks.
  const order = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => {
    const ao = a * 36, bo = b * 36;
    for (let i = 0; i < 36; i++) {
      const da = triBytes[ao + i], db = triBytes[bo + i];
      if (da !== db) return da - db;
    }
    return 0;
  });

  const geomHasher = createHash("sha256");
  // Domain separator with the version, so v2 hashes never collide
  // against v1.
  geomHasher.update(`mat-geom-v${GEOMETRY_HASH_VERSION}|n${triCount}|`);
  for (const idx of sorted) {
    geomHasher.update(triBytes.subarray(idx * 36, idx * 36 + 36));
  }
  const geometryHash = geomHasher.digest("hex");

  return {
    byteHash,
    geometryHash,
    geometryHashVersion: GEOMETRY_HASH_VERSION,
    coarseFingerprint,
    volumeUm3,
    triangleCount: triCount,
    bboxXUm,
    bboxYUm,
    bboxZUm,
  };
}

function compareVec3(a: [number, number, number], b: [number, number, number]) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

// ---- STL parser ----
//
// STL has two flavors. Binary: 80-byte header, uint32 triangle count,
// then 50 bytes per triangle (12 floats + 2-byte attribute). ASCII:
// `solid <name>` then repeated `facet normal ... outer loop ... vertex
// x y z (×3) ... endloop endfacet`. We sniff which one we're looking
// at by checking whether the file starts with `solid` AND its byte
// length matches the binary triangle-count claim — binary STLs that
// start with the literal bytes `solid` are real and have caused
// silent ASCII-mode misparses in other tooling.

function parseStl(buf: Uint8Array): Float64Array {
  // Try binary first by checking the size invariant.
  if (buf.length >= 84) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const triCount = dv.getUint32(80, true);
    const expected = 84 + triCount * 50;
    if (expected === buf.length) return parseStlBinary(buf, triCount);
  }
  return parseStlAscii(buf);
}

function parseStlBinary(buf: Uint8Array, triCount: number): Float64Array {
  const out = new Float64Array(triCount * 9);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < triCount; i++) {
    // Skip 12-byte normal at offset 84 + i*50.
    const o = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) {
      out[i * 9 + v] = dv.getFloat32(o + v * 4, true);
    }
  }
  return out;
}

function parseStlAscii(buf: Uint8Array): Float64Array {
  const text = new TextDecoder().decode(buf);
  const verts: number[] = [];
  // Split on "vertex" keyword. Reasonably robust for well-formed STLs.
  const re = /vertex\s+(-?[0-9.eE+-]+)\s+(-?[0-9.eE+-]+)\s+(-?[0-9.eE+-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (verts.length === 0 || verts.length % 9 !== 0) {
    return new Float64Array(0);
  }
  return Float64Array.from(verts);
}

// ---- OBJ parser ----
//
// We don't try to honor smoothing groups, materials, or anything but
// the `v` and `f` directives. `f` lines may reference vertex/uv/normal
// indices in a/b/c, a/b, a//c, or a forms — we only care about the
// vertex index (the leading slash-separated number). Faces with >3
// vertices are fan-triangulated.

function parseObj(buf: Uint8Array): Float64Array {
  const text = new TextDecoder().decode(buf);
  const verts: number[] = [];
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0 || line[0] === "#") continue;
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      verts.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      );
    } else if (line.startsWith("f ")) {
      const parts = line.trim().split(/\s+/).slice(1);
      // Resolve each face vert index. Negative indices are relative.
      const totalVerts = verts.length / 3;
      const idxs: number[] = [];
      for (const p of parts) {
        const raw = p.split("/")[0];
        let n = parseInt(raw, 10);
        if (Number.isNaN(n)) return new Float64Array(0);
        if (n < 0) n = totalVerts + n;
        else n = n - 1;
        if (n < 0 || n >= totalVerts) return new Float64Array(0);
        idxs.push(n);
      }
      // Fan-triangulate.
      for (let i = 1; i < idxs.length - 1; i++) {
        const a = idxs[0] * 3, b = idxs[i] * 3, c = idxs[i + 1] * 3;
        out.push(
          verts[a],     verts[a + 1], verts[a + 2],
          verts[b],     verts[b + 1], verts[b + 2],
          verts[c],     verts[c + 1], verts[c + 2]
        );
      }
    }
  }
  return out.length === 0 ? new Float64Array(0) : Float64Array.from(out);
}
