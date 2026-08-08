import { describe, it, expect } from "vitest";

import { buildCanarySolid, CANARY_FILENAME } from "../canary-solid";

/**
 * The canary is only useful if its own test file is unimpeachable. A
 * malformed or degenerate solid would make CraftCloud reject it on
 * geometric grounds, and every alert would then mean "our fixture is
 * bad" instead of "the pipeline is broken" — which is worse than
 * having no canary at all. These tests parse the bytes back and check
 * the mesh is a real closed manifold.
 */

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;

function parse(bytes: Uint8Array) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  const count = view.getUint32(HEADER_BYTES, true);
  const triangles: Array<{
    normal: [number, number, number];
    vertices: Array<[number, number, number]>;
  }> = [];

  let offset = HEADER_BYTES + COUNT_BYTES;
  for (let i = 0; i < count; i++) {
    const read = (): [number, number, number] => {
      const v: [number, number, number] = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ];
      offset += 12;
      return v;
    };
    const normal = read();
    const vertices = [read(), read(), read()];
    offset += 2; // attribute byte count
    triangles.push({ normal, vertices });
  }
  return { count, triangles };
}

describe("buildCanarySolid", () => {
  it("is a well-formed binary STL of the documented size", () => {
    const bytes = buildCanarySolid();
    const { count } = parse(bytes);

    expect(count).toBe(4);
    expect(bytes.byteLength).toBe(
      HEADER_BYTES + COUNT_BYTES + count * TRIANGLE_BYTES
    );
    // Spelled out too, so a change to the layout constants can't make
    // this assertion vacuously true.
    expect(bytes.byteLength).toBe(284);
  });

  it("is byte-for-byte deterministic", () => {
    expect(Array.from(buildCanarySolid())).toEqual(
      Array.from(buildCanarySolid())
    );
  });

  it("carries an identifying header", () => {
    const header = new TextDecoder()
      .decode(buildCanarySolid().slice(0, HEADER_BYTES))
      .replace(/\0+$/, "");
    expect(header).toContain("materialize");
    expect(header).toContain("canary");
  });

  // Four faces, four distinct corners, every edge shared by exactly
  // two faces: the definition of a closed manifold. If this holds, no
  // sane parser can call the mesh degenerate.
  it("describes a closed manifold tetrahedron", () => {
    const { triangles } = parse(buildCanarySolid());

    const corners = new Set(
      triangles.flatMap((t) => t.vertices.map((v) => v.join(",")))
    );
    expect(corners.size).toBe(4);

    const edgeCounts = new Map<string, number>();
    for (const { vertices } of triangles) {
      for (let i = 0; i < 3; i++) {
        const a = vertices[i].join(",");
        const b = vertices[(i + 1) % 3].join(",");
        // Undirected key: an edge is the same edge from either side.
        const key = [a, b].sort().join("|");
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
    expect(edgeCounts.size).toBe(6);
    for (const count of edgeCounts.values()) expect(count).toBe(2);
  });

  it("has no zero-area faces", () => {
    for (const { vertices } of parse(buildCanarySolid()).triangles) {
      const [p, q, r] = vertices;
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const area =
        Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]
        ) / 2;
      expect(area).toBeGreaterThan(0.1);
    }
  });

  it("writes unit normals that point outward", () => {
    const { triangles } = parse(buildCanarySolid());

    // Centroid of the solid; a correctly wound face's normal points
    // away from it.
    const all = triangles.flatMap((t) => t.vertices);
    const centre = [0, 1, 2].map(
      (axis) => all.reduce((sum, v) => sum + v[axis], 0) / all.length
    );

    for (const { normal, vertices } of triangles) {
      expect(Math.hypot(...normal)).toBeCloseTo(1, 4);

      const faceCentre = [0, 1, 2].map(
        (axis) => vertices.reduce((sum, v) => sum + v[axis], 0) / 3
      );
      const outward = [0, 1, 2].map((axis) => faceCentre[axis] - centre[axis]);
      const dot = normal.reduce((sum, n, axis) => sum + n * outward[axis], 0);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("uses an .stl filename the upload chain will accept", () => {
    expect(CANARY_FILENAME.endsWith(".stl")).toBe(true);
  });
});
