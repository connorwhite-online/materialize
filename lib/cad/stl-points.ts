/**
 * Compact surface point clouds from STL bytes (MTR live-morph previews).
 *
 * The studio's forming point cloud morphs toward each in-progress solid as
 * snapshot events land. Shipping the full STL per attempt is off the table
 * (megabytes, per exec) — instead the executor samples a small area-weighted
 * set of surface points and streams them beside the render PNG. 2048 points ×
 * 3 float32 ≈ 24 KB raw (~32 KB base64), comparable to the PNG it rides with.
 *
 * Points are in the model's own coordinate space (mm) — the client centers and
 * scales them into the shared studio frame, same as it frames full geometry.
 */

/** Default sample count — dense enough to read as the shape, cheap to ship. */
export const SNAPSHOT_POINT_COUNT = 2048;

interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

function parseBinaryStl(buf: Buffer): Tri[] | null {
  if (buf.length < 84) return null;
  const triCount = buf.readUInt32LE(80);
  if (triCount === 0 || buf.length < 84 + triCount * 50) return null;
  const tris: Tri[] = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    // 12 bytes normal (skipped) + 3 × 12-byte vertices + 2-byte attribute.
    const o = 84 + t * 50 + 12;
    tris[t] = {
      ax: buf.readFloatLE(o), ay: buf.readFloatLE(o + 4), az: buf.readFloatLE(o + 8),
      bx: buf.readFloatLE(o + 12), by: buf.readFloatLE(o + 16), bz: buf.readFloatLE(o + 20),
      cx: buf.readFloatLE(o + 24), cy: buf.readFloatLE(o + 28), cz: buf.readFloatLE(o + 32),
    };
  }
  return tris;
}

function parseAsciiStl(text: string): Tri[] | null {
  const verts: number[] = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const triCount = Math.floor(verts.length / 9);
  if (triCount === 0) return null;
  const tris: Tri[] = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    tris[t] = {
      ax: verts[o], ay: verts[o + 1], az: verts[o + 2],
      bx: verts[o + 3], by: verts[o + 4], bz: verts[o + 5],
      cx: verts[o + 6], cy: verts[o + 7], cz: verts[o + 8],
    };
  }
  return tris;
}

/**
 * Area-weighted surface samples of an STL, base64-encoded little-endian
 * Float32 xyz triples. Null on anything unparsable — the snapshot event just
 * ships without points and the cloud stays a blob (fail-open, cosmetic).
 */
export function sampleStlPoints(
  stlBase64: string,
  count = SNAPSHOT_POINT_COUNT
): string | null {
  try {
    const buf = Buffer.from(stlBase64, "base64");
    // ASCII files start with "solid", but so can binary headers — trust the
    // binary layout check first and fall back to text parsing.
    const tris =
      parseBinaryStl(buf) ??
      parseAsciiStl(buf.toString("utf8", 0, Math.min(buf.length, 32_000_000)));
    if (!tris || tris.length === 0) return null;

    // Cumulative triangle areas for area-weighted sampling.
    const cum = new Float64Array(tris.length);
    let total = 0;
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      const ux = tri.bx - tri.ax, uy = tri.by - tri.ay, uz = tri.bz - tri.az;
      const vx = tri.cx - tri.ax, vy = tri.cy - tri.ay, vz = tri.cz - tri.az;
      const wx = uy * vz - uz * vy;
      const wy = uz * vx - ux * vz;
      const wz = ux * vy - uy * vx;
      total += Math.sqrt(wx * wx + wy * wy + wz * wz) * 0.5;
      cum[t] = total;
    }
    if (!(total > 0)) return null;

    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Stratified: one jittered target per stratum keeps coverage even.
      const target = ((i + Math.random()) / count) * total;
      let lo = 0;
      let hi = tris.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const tri = tris[lo];
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      out[i * 3] = tri.ax + (tri.bx - tri.ax) * u + (tri.cx - tri.ax) * v;
      out[i * 3 + 1] = tri.ay + (tri.by - tri.ay) * u + (tri.cy - tri.ay) * v;
      out[i * 3 + 2] = tri.az + (tri.bz - tri.az) * u + (tri.cz - tri.az) * v;
    }
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString(
      "base64"
    );
  } catch {
    return null;
  }
}
