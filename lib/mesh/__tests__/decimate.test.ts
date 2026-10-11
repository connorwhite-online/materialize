import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { parseMeshTriangles } from "@/lib/hashing/mesh-fingerprint";
import {
  PREVIEW_GRID_CELLS,
  buildLowDetailModel,
  decimateTriangles,
  read3mfUnit,
  triangleBounds,
  write3mf,
  writeBinaryStl,
  writeObj,
  type IndexedMesh,
} from "../decimate";

/** UV sphere as a flat triangle list — dense enough that a 64-cell grid must weld it. */
function sphere(radius: number, segments: number, rings: number): Float64Array {
  const point = (r: number, s: number): [number, number, number] => {
    const theta = (r / rings) * Math.PI;
    const phi = (s / segments) * 2 * Math.PI;
    return [
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta),
    ];
  };
  const out: number[] = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = point(r, s), b = point(r + 1, s);
      const c = point(r + 1, s + 1), d = point(r, s + 1);
      if (r > 0) out.push(...a, ...b, ...d);
      if (r < rings - 1) out.push(...b, ...c, ...d);
    }
  }
  return Float64Array.from(out);
}

function toTriangles(mesh: IndexedMesh): Float64Array {
  const out = new Float64Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i] * 3;
    out[i * 3] = mesh.positions[v];
    out[i * 3 + 1] = mesh.positions[v + 1];
    out[i * 3 + 2] = mesh.positions[v + 2];
  }
  return out;
}

const DENSE = sphere(50, 400, 200); // ~159k triangles

describe("decimateTriangles", () => {
  it("exports the grid resolution the preview pipeline uses", () => {
    expect(PREVIEW_GRID_CELLS).toBe(64);
  });

  it("drops the triangle count on a dense mesh", () => {
    const input = DENSE.length / 9;
    const mesh = decimateTriangles(DENSE);
    const output = mesh.indices.length / 3;
    expect(input).toBeGreaterThan(150_000);
    expect(output).toBeGreaterThan(1_000); // still a recognizable sphere
    expect(output).toBeLessThan(input / 2);
  });

  it("is coarser at fewer cells", () => {
    const fine = decimateTriangles(DENSE, 96).indices.length;
    const coarse = decimateTriangles(DENSE, 24).indices.length;
    expect(coarse).toBeLessThan(fine);
  });

  it("stays within the original bounding box", () => {
    const before = triangleBounds(DENSE);
    const after = triangleBounds(toTriangles(decimateTriangles(DENSE)));
    for (let a = 0; a < 3; a++) {
      expect(after.min[a]).toBeGreaterThanOrEqual(before.min[a]);
      expect(after.max[a]).toBeLessThanOrEqual(before.max[a]);
    }
  });

  it("removes degenerate and duplicate triangles", () => {
    const tris = Float64Array.from([
      // a real triangle spanning the box
      0, 0, 0, 100, 0, 0, 0, 100, 0,
      // its exact duplicate, and its reverse winding
      0, 0, 0, 100, 0, 0, 0, 100, 0,
      0, 0, 0, 0, 100, 0, 100, 0, 0,
      // a sliver whose corners all land in one cell
      50, 50, 0, 50.1, 50, 0, 50, 50.1, 0,
      // a zero-area triangle with a repeated vertex
      10, 10, 0, 10, 10, 0, 90, 90, 0,
    ]);
    const mesh = decimateTriangles(tris);
    expect(mesh.indices.length / 3).toBe(1);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.subarray(i, i + 3);
      expect(new Set([a, b, c]).size).toBe(3);
    }
  });

  it("drops non-finite triangles instead of poisoning the bbox", () => {
    const tris = Float64Array.from([
      0, 0, 0, 10, 0, 0, 0, 10, 0,
      NaN, 0, 0, 10, 0, 0, 0, 10, 0,
    ]);
    const mesh = decimateTriangles(tris);
    expect(mesh.indices.length).toBe(3);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
  });

  it("returns an empty mesh for empty or zero-extent input", () => {
    expect(decimateTriangles(new Float64Array(0)).indices.length).toBe(0);
    expect(
      decimateTriangles(Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1])).indices.length
    ).toBe(0);
  });
});

describe("writers round-trip through parseMeshTriangles", () => {
  const mesh = decimateTriangles(sphere(20, 40, 20));
  const expected = toTriangles(mesh);

  function expectSameTriangles(parsed: Float64Array | null, tolerance: number) {
    expect(parsed).not.toBeNull();
    expect(parsed!.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(parsed![i] - expected[i])).toBeLessThan(tolerance);
    }
  }

  it("binary STL", () => {
    const bytes = writeBinaryStl(mesh);
    expect(bytes.length).toBe(84 + (mesh.indices.length / 3) * 50);
    expectSameTriangles(parseMeshTriangles(bytes, "stl"), 1e-4);
  });

  it("OBJ", () => {
    expectSameTriangles(parseMeshTriangles(writeObj(mesh), "obj"), 1e-4);
  });

  it("3MF", () => {
    const pkg = write3mf(mesh, "inch");
    expectSameTriangles(parseMeshTriangles(pkg, "3mf"), 1e-4);
    const files = unzipSync(pkg);
    expect(Object.keys(files).sort()).toEqual(
      ["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"].sort()
    );
    expect(strFromU8(files["_rels/.rels"])).toContain("/3D/3dmodel.model");
    expect(read3mfUnit(pkg)).toBe("inch");
  });

  it("3MF falls back to millimeter for an unknown unit", () => {
    expect(read3mfUnit(write3mf(mesh, "parsec"))).toBe("millimeter");
  });
});

describe("buildLowDetailModel", () => {
  it("keeps the original's format and shrinks a dense mesh", () => {
    const stl = writeBinaryStl({
      positions: DENSE,
      indices: Uint32Array.from({ length: DENSE.length / 3 }, (_, i) => i),
    });
    for (const format of ["stl", "obj", "3mf"] as const) {
      const original =
        format === "stl"
          ? stl
          : format === "obj"
            ? writeObj(decimateTriangles(DENSE, 400))
            : write3mf(decimateTriangles(DENSE, 400), "centimeter");
      const out = buildLowDetailModel(original, format);
      expect(out).not.toBeNull();
      expect(out!.outputTriangles).toBeLessThan(out!.inputTriangles);
      expect(parseMeshTriangles(out!.bytes, format)!.length / 9).toBe(out!.outputTriangles);
      if (format === "3mf") expect(read3mfUnit(out!.bytes)).toBe("centimeter");
    }
  });

  it("returns null for formats without a browser loader and for garbage", () => {
    expect(buildLowDetailModel(new Uint8Array(10), "step")).toBeNull();
    expect(buildLowDetailModel(new Uint8Array(10), "amf")).toBeNull();
    expect(buildLowDetailModel(new Uint8Array([1, 2, 3]), "3mf")).toBeNull();
  });
});
