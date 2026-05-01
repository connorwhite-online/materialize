import { describe, it, expect } from "vitest";
import {
  computeFingerprintFromTriangles,
  fingerprintFromStream,
} from "../mesh-fingerprint";

// Build an axis-aligned box (12 triangles) starting at origin with the
// given size in mm. Used for both fingerprint and STL-byte tests.
function makeBoxTriangles(sx: number, sy: number, sz: number): Float64Array {
  const v = [
    [0, 0, 0],   [sx, 0, 0],  [sx, sy, 0], [0, sy, 0],
    [0, 0, sz],  [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  // 12 triangles, two per face, CCW from outside.
  const f: [number, number, number][] = [
    [0, 1, 2], [0, 2, 3], // -Z
    [4, 6, 5], [4, 7, 6], // +Z
    [0, 4, 5], [0, 5, 1], // -Y
    [2, 6, 7], [2, 7, 3], // +Y (swap orientation)
    [1, 5, 6], [1, 6, 2], // +X
    [0, 3, 7], [0, 7, 4], // -X
  ];
  const out: number[] = [];
  for (const [a, b, c] of f) {
    out.push(...v[a], ...v[b], ...v[c]);
  }
  return Float64Array.from(out);
}

function makeBinaryStl(triangles: Float64Array): Uint8Array {
  const triCount = triangles.length / 9;
  const buf = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(buf.buffer);
  dv.setUint32(80, triCount, true);
  for (let i = 0; i < triCount; i++) {
    const o = 84 + i * 50;
    // Normal (zeros — readers don't need it for our fingerprint).
    for (let k = 0; k < 9; k++) {
      dv.setFloat32(o + 12 + k * 4, triangles[i * 9 + k], true);
    }
  }
  return buf;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("mesh-fingerprint", () => {
  it("produces stable byte hash for identical bytes", async () => {
    const tris = makeBoxTriangles(20, 30, 40);
    const stl = makeBinaryStl(tris);
    const a = await fingerprintFromStream(streamOf(stl), "stl", "mm");
    const b = await fingerprintFromStream(streamOf(stl), "stl", "mm");
    expect(a.byteHash).toBe(b.byteHash);
    expect(a.geometryHash).toBe(b.geometryHash);
    expect(a.coarseFingerprint).toBe(b.coarseFingerprint);
  });

  it("produces matching geometry hashes regardless of triangle order", () => {
    const t1 = makeBoxTriangles(20, 30, 40);
    const t2 = new Float64Array(t1.length);
    // Reverse triangle order.
    const triCount = t1.length / 9;
    for (let i = 0; i < triCount; i++) {
      const src = (triCount - 1 - i) * 9;
      const dst = i * 9;
      for (let k = 0; k < 9; k++) t2[dst + k] = t1[src + k];
    }
    const a = computeFingerprintFromTriangles("a", t1, "mm");
    const b = computeFingerprintFromTriangles("b", t2, "mm");
    expect(a.geometryHash).toBe(b.geometryHash);
    expect(a.coarseFingerprint).toBe(b.coarseFingerprint);
  });

  it("produces matching geometry hashes for the same shape in different units", () => {
    // 20×30×40mm vs 2×3×4cm — same physical model.
    const mm = makeBoxTriangles(20, 30, 40);
    const cm = makeBoxTriangles(2, 3, 4);
    const a = computeFingerprintFromTriangles("a", mm, "mm");
    const b = computeFingerprintFromTriangles("b", cm, "cm");
    expect(a.geometryHash).toBe(b.geometryHash);
    // Coarse fingerprint should also match because we normalize to mm.
    expect(a.coarseFingerprint).toBe(b.coarseFingerprint);
    expect(a.volumeUm3).toBe(b.volumeUm3);
  });

  it("produces matching geometry hashes when geometry is uniformly scaled", () => {
    // The normalized geometry hash is similarity-invariant — it
    // catches a uniformly-scaled re-export. (The coarse fingerprint
    // differs because that one is in absolute mm.)
    const small = makeBoxTriangles(1, 1.5, 2);
    const big = makeBoxTriangles(10, 15, 20);
    const a = computeFingerprintFromTriangles("a", small, "mm");
    const b = computeFingerprintFromTriangles("b", big, "mm");
    expect(a.geometryHash).toBe(b.geometryHash);
    expect(a.coarseFingerprint).not.toBe(b.coarseFingerprint);
  });

  it("produces different geometry hashes for different shapes", () => {
    const cube = makeBoxTriangles(20, 20, 20);
    const slab = makeBoxTriangles(40, 20, 5);
    const a = computeFingerprintFromTriangles("a", cube, "mm");
    const b = computeFingerprintFromTriangles("b", slab, "mm");
    expect(a.geometryHash).not.toBe(b.geometryHash);
    expect(a.coarseFingerprint).not.toBe(b.coarseFingerprint);
  });

  it("computes plausible volume and bbox stats for a 20×30×40 box", () => {
    const tris = makeBoxTriangles(20, 30, 40);
    const fp = computeFingerprintFromTriangles("a", tris, "mm");
    expect(fp.bboxXUm).toBe(20_000);
    expect(fp.bboxYUm).toBe(30_000);
    expect(fp.bboxZUm).toBe(40_000);
    // Volume = 24,000 mm³ → 2.4e13 µm³.
    expect(fp.volumeUm3).toBe(24_000 * 1e9);
    expect(fp.triangleCount).toBe(12);
  });

  it("returns empty fingerprint for unparseable formats but still byte-hashes", async () => {
    const fakeStep = new Uint8Array([0x49, 0x53, 0x4f, 0x2d]); // ISO-
    const fp = await fingerprintFromStream(streamOf(fakeStep), "step", "mm");
    expect(fp.byteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.geometryHash).toBeNull();
    expect(fp.coarseFingerprint).toBeNull();
  });

  it("parses ASCII STL", async () => {
    const ascii = `solid test
      facet normal 0 0 0
        outer loop
          vertex 0 0 0
          vertex 10 0 0
          vertex 0 10 0
        endloop
      endfacet
    endsolid test`;
    const fp = await fingerprintFromStream(
      streamOf(new TextEncoder().encode(ascii)),
      "stl",
      "mm"
    );
    expect(fp.triangleCount).toBe(1);
    expect(fp.geometryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses OBJ and produces same geometry hash as the equivalent STL", async () => {
    // Single triangle in OBJ form.
    const obj = `v 0 0 0
v 10 0 0
v 0 10 0
f 1 2 3
`;
    const tri = Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const objFp = await fingerprintFromStream(
      streamOf(new TextEncoder().encode(obj)),
      "obj",
      "mm"
    );
    const stlFp = computeFingerprintFromTriangles("x", tri, "mm");
    expect(objFp.geometryHash).toBe(stlFp.geometryHash);
  });
});
