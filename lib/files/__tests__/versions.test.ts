import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * attachAssetAsVersion (docs/file-versioning.md): the one writer that adds
 * a version to a file. Pins the numbering, the crash-safe statement order
 * (attach before pointer), and that the asset's old file never keeps
 * pointing at an asset it no longer owns.
 */

vi.mock("@/lib/db/schema", () => ({
  files: { __name: "files", id: "id", currentAssetId: "current_asset_id" },
  fileAssets: {
    __name: "file_assets",
    id: "id",
    fileId: "file_id",
    versionNumber: "version_number",
  },
}));

type Row = Record<string, unknown>;
let selectQueue: Row[][] = [];
const updates: { table: string; values: Row }[] = [];

function selectChain() {
  const rows = Promise.resolve(selectQueue.shift() ?? []);
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) c[m] = () => c;
  c.then = (f?: (v: Row[]) => unknown, r?: (e: unknown) => unknown) =>
    rows.then(f, r);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    update: (table: { __name: string }) => ({
      set: (values: Row) => ({
        where: () => {
          updates.push({ table: table.__name, values });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { attachAssetAsVersion } from "@/lib/files/versions";

describe("attachAssetAsVersion", () => {
  beforeEach(() => {
    selectQueue = [];
    updates.length = 0;
  });

  it("attaches as the next version, then makes it live, then clears the old file's pointer", async () => {
    selectQueue = [
      [{ fileId: "draft-file", versionNumber: 1 }], // asset lives on its studio draft
      [{ top: 3 }], // saved file already has v1..v3
    ];
    const res = await attachAssetAsVersion({
      fileId: "saved-file",
      assetId: "asset-new",
      note: "thicker walls",
    });
    expect(res).toEqual({ versionNumber: 4 });
    expect(updates).toEqual([
      {
        table: "file_assets",
        values: { fileId: "saved-file", versionNumber: 4, versionNote: "thicker walls" },
      },
      { table: "files", values: { currentAssetId: null } },
      {
        table: "files",
        values: expect.objectContaining({ currentAssetId: "asset-new" }),
      },
    ]);
  });

  it("starts at v1 on a file with no versions", async () => {
    selectQueue = [[{ fileId: null, versionNumber: null }], [{ top: null }]];
    const res = await attachAssetAsVersion({ fileId: "f", assetId: "a" });
    expect(res).toEqual({ versionNumber: 1 });
    // No old file → no pointer to clear.
    expect(updates.map((u) => u.table)).toEqual(["file_assets", "files"]);
  });

  it("re-attaching a version the file already has keeps its number and only moves the pointer", async () => {
    selectQueue = [[{ fileId: "f", versionNumber: 2 }]];
    const res = await attachAssetAsVersion({ fileId: "f", assetId: "a2" });
    expect(res).toEqual({ versionNumber: 2 });
    expect(updates).toEqual([
      {
        table: "files",
        values: expect.objectContaining({ currentAssetId: "a2" }),
      },
    ]);
  });

  it("makeCurrent: false records history without changing what's live", async () => {
    selectQueue = [[{ fileId: null, versionNumber: null }], [{ top: 1 }]];
    await attachAssetAsVersion({ fileId: "f", assetId: "a", makeCurrent: false });
    expect(updates.map((u) => u.table)).toEqual(["file_assets"]);
  });

  it("throws on an unknown asset", async () => {
    selectQueue = [[]];
    await expect(
      attachAssetAsVersion({ fileId: "f", assetId: "nope" })
    ).rejects.toThrow(/not found/);
  });
});
