// Pure mesh decimation + writers for the low-detail preview of paid
// listings (lib/files/model-preview.ts). No `server-only`, no env reads,
// no IO: everything here is a function of its arguments, so it is unit
// tested without R2 and can be reused from scripts.
//
// The point is a mesh that is recognizable in the 3D viewer and too
// coarse to be worth printing. Vertex clustering does exactly that and
// nothing more: snap every vertex to a uniform grid, weld each cell's
// vertices into one at their mean, and drop the triangles that collapse.
// Detail smaller than a cell is gone for good — fillets, threads, text,
// tolerances — while the silhouette survives. It is not a
// quality-preserving simplifier (no quadrics, no feature edges) and must
// not become one: a better-looking decimation is a more printable one.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseMeshTriangles } from "@/lib/hashing/mesh-fingerprint";

/**
 * Grid resolution along the mesh's LONGEST bounding-box extent. A cell is
 * `longestExtent / PREVIEW_GRID_CELLS` on every axis (cubic cells), so a
 * 200mm part welds everything inside ~3mm. Changing this changes every
 * preview's bytes: bump PREVIEW_KEY_VERSION in lib/files/model-preview.ts
 * with it, or cached previews keep the old resolution forever.
 */
export const PREVIEW_GRID_CELLS = 64;

/** Indexed triangle mesh. `positions` is xyz per vertex, `indices` 3 per triangle. */
export type IndexedMesh = {
  positions: Float64Array;
  indices: Uint32Array;
};

export type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
};

/** Bounding box of a flat triangle list (9 floats per triangle). */
export function triangleBounds(triangles: Float64Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = triangles[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Vertex-clustering decimation of a flat triangle list (the shape
 * `parseMeshTriangles` returns).
 *
 * - Cell size = longest bbox extent / `cells`, same on every axis.
 * - Each occupied cell becomes one vertex at the MEAN of the input
 *   vertices that fell in it. A mean of points inside the bbox is inside
 *   the bbox (it's convex), so the output never grows past the original.
 * - A triangle whose corners land in fewer than three distinct cells is
 *   degenerate and dropped; of triangles over the same three cells (in
 *   either winding) only the first survives — the second is either a
 *   duplicate or the back face of a collapsed sliver.
 *
 * Non-finite coordinates are dropped with their triangle rather than
 * poisoning the bbox.
 */
export function decimateTriangles(
  triangles: Float64Array,
  cells: number = PREVIEW_GRID_CELLS
): IndexedMesh {
  const triCount = Math.floor(triangles.length / 9);
  // Bounds over finite triangles only.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const finite = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let ok = true;
    for (let k = 0; k < 9; k++) {
      if (!Number.isFinite(triangles[t * 9 + k])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    finite[t] = 1;
    for (let k = 0; k < 9; k++) {
      const a = k % 3;
      const v = triangles[t * 9 + k];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!(min[0] <= max[0])) {
    return { positions: new Float64Array(0), indices: new Uint32Array(0) };
  }

  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const n = Math.max(1, Math.floor(cells));
  // A zero-extent mesh (every vertex identical) collapses to nothing.
  if (longest <= 0) {
    return { positions: new Float64Array(0), indices: new Uint32Array(0) };
  }
  const cellSize = longest / n;
  // Cells per axis; the far face lands on index `n`, so clamp to n - 1.
  const dims = [0, 1, 2].map((a) =>
    Math.min(n, Math.max(1, Math.ceil((max[a] - min[a]) / cellSize)))
  );

  const cellOf = (x: number, y: number, z: number): number => {
    const ix = Math.min(dims[0] - 1, Math.floor((x - min[0]) / cellSize));
    const iy = Math.min(dims[1] - 1, Math.floor((y - min[1]) / cellSize));
    const iz = Math.min(dims[2] - 1, Math.floor((z - min[2]) / cellSize));
    return ix + dims[0] * (iy + dims[1] * iz);
  };

  // cell key → output vertex index; running sums for the mean.
  const vertexOfCell = new Map<number, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  const corner = (t: number, c: number): number => {
    const o = t * 9 + c * 3;
    const x = triangles[o], y = triangles[o + 1], z = triangles[o + 2];
    const key = cellOf(x, y, z);
    let idx = vertexOfCell.get(key);
    if (idx === undefined) {
      idx = counts.length;
      vertexOfCell.set(key, idx);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[idx * 3] += x;
    sums[idx * 3 + 1] += y;
    sums[idx * 3 + 2] += z;
    counts[idx] += 1;
    return idx;
  };

  const out: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < triCount; t++) {
    if (!finite[t]) continue;
    // Every vertex contributes to its cell's mean, even on a triangle
    // that ends up dropped — the welded vertex is the cell's centroid
    // of the ORIGINAL surface, not of the survivors.
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((p, q) => p - q);
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a, b, c);
  }

  // Compact: only vertices some surviving triangle references.
  const remap = new Int32Array(counts.length).fill(-1);
  const positions: number[] = [];
  const indices = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (remap[v] === -1) {
      remap[v] = positions.length / 3;
      const k = counts[v];
      // Clamp guards against float drift in the mean pushing a hair past
      // the original bbox.
      positions.push(
        clamp(sums[v * 3] / k, min[0], max[0]),
        clamp(sums[v * 3 + 1] / k, min[1], max[1]),
        clamp(sums[v * 3 + 2] / k, min[2], max[2])
      );
    }
    indices[i] = remap[v];
  }
  return { positions: Float64Array.from(positions), indices };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Writers. Each output must load in the same three.js loader as the   */
/* original's format (the viewer picks the loader from fileAssets.format */
/* client-side), and round-trips through parseMeshTriangles.           */
/* ------------------------------------------------------------------ */

/** Binary STL with per-face normals. Coordinates are float32, per the format. */
export function writeBinaryStl(mesh: IndexedMesh): Uint8Array {
  const triCount = mesh.indices.length / 3;
  const buf = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(buf.buffer);
  const header = strToU8("Materialize low-detail preview");
  buf.set(header.subarray(0, 80), 0);
  dv.setUint32(80, triCount, true);
  const p = mesh.positions;
  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3] * 3;
    const ib = mesh.indices[t * 3 + 1] * 3;
    const ic = mesh.indices[t * 3 + 2] * 3;
    const ux = p[ib] - p[ia], uy = p[ib + 1] - p[ia + 1], uz = p[ib + 2] - p[ia + 2];
    const vx = p[ic] - p[ia], vy = p[ic + 1] - p[ia + 1], vz = p[ic + 2] - p[ia + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    let o = 84 + t * 50;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const base of [ia, ib, ic]) {
      dv.setFloat32(o, p[base], true);
      dv.setFloat32(o + 4, p[base + 1], true);
      dv.setFloat32(o + 8, p[base + 2], true);
      o += 12;
    }
    // 2-byte attribute count stays 0.
  }
  return buf;
}

function fmt(n: number): string {
  // 7 significant digits (float32's precision) is far below a grid cell, so there's no point paying bytes for more.
  return Number(n.toPrecision(7)).toString();
}

/** Wavefront OBJ: `v` + 1-based `f` lines, nothing else. */
export function writeObj(mesh: IndexedMesh): Uint8Array {
  const lines: string[] = ["# Materialize low-detail preview"];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    lines.push(`v ${fmt(p[i])} ${fmt(p[i + 1])} ${fmt(p[i + 2])}`);
  }
  const ix = mesh.indices;
  for (let i = 0; i < ix.length; i += 3) {
    lines.push(`f ${ix[i] + 1} ${ix[i + 1] + 1} ${ix[i + 2] + 1}`);
  }
  return strToU8(lines.join("\n") + "\n");
}

const THREE_MF_UNITS = new Set([
  "micron",
  "millimeter",
  "centimeter",
  "inch",
  "foot",
  "meter",
]);

/**
 * Minimal valid 3MF package: [Content_Types].xml, _rels/.rels and one
 * object in 3D/3dmodel.model with a single build item at identity
 * (`parseMeshTriangles` already applied the original's build transforms).
 * `unit` should carry over the original model's unit so the preview is
 * the same physical size; anything unrecognised falls back to the 3MF
 * default, millimeter.
 */
export function write3mf(mesh: IndexedMesh, unit: string = "millimeter"): Uint8Array {
  const safeUnit = THREE_MF_UNITS.has(unit) ? unit : "millimeter";
  const p = mesh.positions;
  const ix = mesh.indices;
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<model unit="${safeUnit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`,
    `<resources><object id="1" type="model"><mesh><vertices>`,
  ];
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`<vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>`);
  }
  parts.push(`</vertices><triangles>`);
  for (let i = 0; i < ix.length; i += 3) {
    parts.push(`<triangle v1="${ix[i]}" v2="${ix[i + 1]}" v3="${ix[i + 2]}"/>`);
  }
  parts.push(
    `</triangles></mesh></object></resources>`,
    `<build><item objectid="1"/></build>`,
    `</model>`
  );

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "3D/3dmodel.model": strToU8(parts.join("")),
    },
    { level: 6 }
  );
}

/**
 * The `unit` attribute of a 3MF package's root <model>, or null when the
 * package can't be read or declares none (3MF's default is millimeter).
 */
export function read3mfUnit(pkg: Uint8Array): string | null {
  try {
    const entries = unzipSync(pkg, {
      filter: (file) => file.name === "3D/3dmodel.model",
    });
    const model = entries["3D/3dmodel.model"];
    if (!model) return null;
    // The root element is near the top; don't decode a huge mesh for it.
    const head = strFromU8(model.subarray(0, 4096));
    const m = /<model\b[^>]*\bunit\s*=\s*"([^"]+)"/.exec(head);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export type PreviewFormat = "stl" | "obj" | "3mf";

export function isPreviewFormat(format: string): format is PreviewFormat {
  return format === "stl" || format === "obj" || format === "3mf";
}

/**
 * Original model bytes → low-detail bytes in the SAME format, or null
 * when the format has no browser loader (STEP/AMF) or the file doesn't
 * parse. Callers must treat null as "serve nothing", never as "serve the
 * original".
 */
export function buildLowDetailModel(
  original: Uint8Array,
  format: string,
  cells: number = PREVIEW_GRID_CELLS
): { bytes: Uint8Array; inputTriangles: number; outputTriangles: number } | null {
  if (!isPreviewFormat(format)) return null;
  const triangles = parseMeshTriangles(original, format);
  if (!triangles) return null;
  const mesh = decimateTriangles(triangles, cells);
  if (mesh.indices.length === 0) return null;
  const bytes =
    format === "stl"
      ? writeBinaryStl(mesh)
      : format === "obj"
        ? writeObj(mesh)
        : write3mf(mesh, read3mfUnit(original) ?? undefined);
  return {
    bytes,
    inputTriangles: triangles.length / 9,
    outputTriangles: mesh.indices.length / 3,
  };
}
