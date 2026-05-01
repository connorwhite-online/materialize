// No `server-only` here — pure hashing logic, no env reads. The Node
// `crypto` import already prevents bundler-side use from a client
// component. Letting Node scripts (e.g. the backfill in
// scripts/backfill-mesh-fingerprint.ts) import it directly.
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";

// Geometry hash version — bump whenever the normalization rules below
// change, so old rows can be backfilled instead of mixing schemes
// silently in the same index.
export const GEOMETRY_HASH_VERSION = 1;

const PARSEABLE_FORMATS = new Set(["stl", "obj", "3mf"]);

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
    else if (format === "3mf") triangles = parse3mf(buf);
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

// ---- 3mf parser ----
//
// 3mf is a ZIP container (OPC, the same packaging convention as docx)
// with the geometry XML at `3D/3dmodel.model`. The relevant pieces:
//
//   <model>
//     <resources>
//       <object id="1"><mesh>
//         <vertices>
//           <vertex x="..." y="..." z="..."/> ...
//         </vertices>
//         <triangles>
//           <triangle v1="0" v2="1" v3="2"/> ...
//         </triangles>
//       </mesh></object>
//       <object id="2">...</object>
//     </resources>
//     <build>
//       <item objectid="1" transform="m11 m21 m31 m12 m22 m32 m13 m23 m33 t1 t2 t3"/>
//     </build>
//   </model>
//
// We don't pull in an XML parser. The element shapes are simple and
// regex-extractable, and 3mf in the wild is well-formed (it has to
// pass schema validation to load in slicers). What we DO handle:
//
//   - multiple <object> blocks with their own meshes
//   - <build><item> instancing with optional column-major 4x3 transform
//   - objects without a build item (rare but legal — fingerprinted at
//     identity transform; matches what a slicer would do if you load
//     the file with no scene data)
//
// What we DON'T handle (returns empty fingerprint, falls through to
// byte-hash-only):
//
//   - <components>: object-of-objects references. Real but rare.
//   - <beamlattice>: lattice extension. Not a triangle mesh.
//   - production extension's external part references.
//
// Build transforms make translation and uniform-scale dedup-equivalent
// (we normalize both anyway downstream), but rotations baked into the
// transform DO change the geometry hash. Same caveat as STL/OBJ: we
// don't normalize rotation.

type ParsedObject = { vertices: Float64Array; triIndices: Int32Array };

function parse3mf(buf: Uint8Array): Float64Array {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf, {
      filter: (file) => file.name === "3D/3dmodel.model",
    });
  } catch {
    return new Float64Array(0);
  }
  const modelBytes = entries["3D/3dmodel.model"];
  if (!modelBytes) return new Float64Array(0);
  const xml = strFromU8(modelBytes);

  // Parse all <object> blocks. Each gets its own vertex/triangle list,
  // keyed by id so the build section can transform-and-instance them.
  const objects = new Map<string, ParsedObject>();
  const objRe = /<object\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/object>/g;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objRe.exec(xml)) !== null) {
    const id = objMatch[1];
    const body = objMatch[2];
    const obj = parseObjectBody(body);
    if (obj) objects.set(id, obj);
  }
  if (objects.size === 0) return new Float64Array(0);

  // Build section: each <item> instantiates an object, optionally with
  // a transform. If there's no <build> section (or no items), fall back
  // to emitting every object once at identity — covers the legal-but-
  // unusual "model without a scene" case.
  type BuildItem = { objectId: string; transform: number[] | null };
  const items: BuildItem[] = [];
  const itemRe = /<item\b([^>]*)\/?>/g;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(xml)) !== null) {
    const attrs = itemMatch[1];
    const idAttr = /\bobjectid\s*=\s*"([^"]+)"/i.exec(attrs);
    if (!idAttr) continue;
    const transformAttr = /\btransform\s*=\s*"([^"]+)"/i.exec(attrs);
    const transform = transformAttr
      ? parseTransform(transformAttr[1])
      : null;
    items.push({ objectId: idAttr[1], transform });
  }
  if (items.length === 0) {
    for (const id of objects.keys()) items.push({ objectId: id, transform: null });
  }

  const out: number[] = [];
  for (const item of items) {
    const obj = objects.get(item.objectId);
    if (!obj) continue;
    appendInstancedTriangles(out, obj, item.transform);
  }
  return out.length === 0 ? new Float64Array(0) : Float64Array.from(out);
}

function parseObjectBody(body: string): ParsedObject | null {
  // Vertices — 3mf requires explicit x/y/z attributes.
  const vertices: number[] = [];
  const vertRe = /<vertex\b[^>]*\bx\s*=\s*"([^"]+)"[^>]*\by\s*=\s*"([^"]+)"[^>]*\bz\s*=\s*"([^"]+)"/g;
  let vm: RegExpExecArray | null;
  while ((vm = vertRe.exec(body)) !== null) {
    const x = parseFloat(vm[1]);
    const y = parseFloat(vm[2]);
    const z = parseFloat(vm[3]);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
    vertices.push(x, y, z);
  }
  if (vertices.length === 0) return null;

  // Triangles — v1/v2/v3 are zero-based vertex indices.
  const triIndices: number[] = [];
  const triRe = /<triangle\b[^>]*\bv1\s*=\s*"([^"]+)"[^>]*\bv2\s*=\s*"([^"]+)"[^>]*\bv3\s*=\s*"([^"]+)"/g;
  const vertCount = vertices.length / 3;
  let tm: RegExpExecArray | null;
  while ((tm = triRe.exec(body)) !== null) {
    const a = parseInt(tm[1], 10);
    const b = parseInt(tm[2], 10);
    const c = parseInt(tm[3], 10);
    if (
      !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) ||
      a < 0 || b < 0 || c < 0 ||
      a >= vertCount || b >= vertCount || c >= vertCount
    ) {
      return null;
    }
    triIndices.push(a, b, c);
  }
  if (triIndices.length === 0) return null;

  return {
    vertices: Float64Array.from(vertices),
    triIndices: Int32Array.from(triIndices),
  };
}

// 3mf transforms are 12 numbers, column-major:
//   m11 m21 m31  m12 m22 m32  m13 m23 m33  t1 t2 t3
// Layout matches the spec — the rotation/scale 3x3 is the first nine
// values stored column-by-column, then the translation triple.
function parseTransform(raw: string): number[] | null {
  const parts = raw.trim().split(/\s+/).map((s) => parseFloat(s));
  if (parts.length !== 12 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

function appendInstancedTriangles(
  out: number[],
  obj: ParsedObject,
  t: number[] | null
): void {
  const v = obj.vertices;
  const idx = obj.triIndices;

  // No transform = identity, fast path.
  if (!t) {
    for (let i = 0; i < idx.length; i++) {
      const o = idx[i] * 3;
      out.push(v[o], v[o + 1], v[o + 2]);
    }
    return;
  }

  // Apply column-major 3x3 + translation. Per spec:
  //   x' = m11*x + m12*y + m13*z + t1
  //   y' = m21*x + m22*y + m23*z + t2
  //   z' = m31*x + m32*y + m33*z + t3
  const m11 = t[0], m21 = t[1], m31 = t[2];
  const m12 = t[3], m22 = t[4], m32 = t[5];
  const m13 = t[6], m23 = t[7], m33 = t[8];
  const t1 = t[9], t2 = t[10], t3 = t[11];
  for (let i = 0; i < idx.length; i++) {
    const o = idx[i] * 3;
    const x = v[o], y = v[o + 1], z = v[o + 2];
    out.push(
      m11 * x + m12 * y + m13 * z + t1,
      m21 * x + m22 * y + m23 * z + t2,
      m31 * x + m32 * y + m33 * z + t3
    );
  }
}
