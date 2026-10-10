import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMeshTriangles } from "@/lib/hashing/mesh-fingerprint";
import { writeBinaryStl } from "@/lib/mesh/decimate";

const store = new Map<string, Uint8Array>();
const putObject = vi.fn(async (key: string, body: Uint8Array) => {
  store.set(key, body);
});
vi.mock("@/lib/storage", () => ({
  objectExists: async (key: string) =>
    store.has(key) ? { exists: true, sizeBytes: store.get(key)!.length } : { exists: false },
  getObjectBytes: async (key: string) => {
    const v = store.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  },
  putObject: (key: string, body: Uint8Array, type: string) => putObject(key, body, type),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  assetIdFromPreviewKey,
  getPreviewBytes,
  needsLowDetailPreview,
  previewStorageKey,
} from "../model-preview";

/** A finely tessellated 100mm square plate: 2 * n * n triangles. */
function densePlate(n: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) positions.push((x / n) * 100, (y / n) * 100, 0);
  const at = (x: number, y: number) => y * (n + 1) + x;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      indices.push(at(x, y), at(x + 1, y), at(x + 1, y + 1));
      indices.push(at(x, y), at(x + 1, y + 1), at(x, y + 1));
    }
  return writeBinaryStl({
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  });
}

beforeEach(() => {
  store.clear();
  putObject.mockClear();
});

describe("model-preview", () => {
  it("uses a deterministic, versioned key in the original's format", () => {
    expect(previewStorageKey("abc", "3mf")).toBe("previews/abc.v1.3mf");
    expect(assetIdFromPreviewKey("previews/abc.v1.3mf")).toBe("abc");
    expect(assetIdFromPreviewKey("uploads/u/abc.stl")).toBeNull();
    expect(assetIdFromPreviewKey("previews/nested/abc.v1.stl")).toBeNull();
  });

  it("needs a low-detail copy only for paid listings the viewer isn't entitled to", () => {
    expect(needsLowDetailPreview({ price: 0, entitled: false })).toBe(false);
    expect(needsLowDetailPreview({ price: null, entitled: false })).toBe(false);
    expect(needsLowDetailPreview({ price: 500, entitled: true })).toBe(false);
    expect(needsLowDetailPreview({ price: 500, entitled: false })).toBe(true);
  });

  it("generates once, caches at the deterministic key, then serves the cache", async () => {
    store.set("uploads/u/plate.stl", densePlate(300));
    const asset = { id: "a1", storageKey: "uploads/u/plate.stl", format: "stl" };

    const first = await getPreviewBytes(asset);
    expect(first).not.toBeNull();
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject.mock.calls[0][0]).toBe("previews/a1.v1.stl");
    const tris = parseMeshTriangles(first!, "stl")!.length / 9;
    expect(tris).toBeLessThan(2 * 300 * 300);

    const second = await getPreviewBytes(asset);
    expect(second).toEqual(first);
    expect(putObject).toHaveBeenCalledTimes(1);
  });

  it("returns null (never the original) for STEP/AMF and unparseable files", async () => {
    store.set("uploads/u/x.step", new Uint8Array([1, 2, 3]));
    expect(
      await getPreviewBytes({ id: "s", storageKey: "uploads/u/x.step", format: "step" })
    ).toBeNull();
    store.set("uploads/u/x.obj", new TextEncoder().encode("garbage"));
    expect(
      await getPreviewBytes({ id: "o", storageKey: "uploads/u/x.obj", format: "obj" })
    ).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });
});
