import { describe, it, expect, vi, beforeEach } from "vitest";
import { projects, projectFiles, fileAssets } from "@/lib/db/schema";

// Datasets the mocked db serves, keyed by the table each query reads
// from. Reset per test. `loadProjectPrintTiles` issues three reads:
//   1. from(projects)     → the project row
//   2. from(projectFiles) → bundled files (innerJoin files)
//   3. from(fileAssets)   → assets for the bundled file ids
// We route on table identity (schema isn't mocked, so the table
// objects are shared with the loader under test).
let projectRows: unknown[] = [];
let bundledRows: unknown[] = [];
let assetRows: unknown[] = [];

function makeChain(rows: unknown[]) {
  // An array that's also chainable — every builder step returns it, so
  // any order of where/innerJoin/orderBy/limit resolves to the rows,
  // and `await`/destructuring on the terminal yields the array.
  const arr = [...rows];
  const chain = Object.assign(arr, {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
  });
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === projects) return makeChain(projectRows);
        if (table === projectFiles) return makeChain(bundledRows);
        if (table === fileAssets) return makeChain(assetRows);
        return makeChain([]);
      },
    }),
  },
}));

const mockIsOrgMember = vi.fn();
vi.mock("@/lib/authorization", () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

import { loadProjectPrintTiles } from "../project-tiles";

const OWNER = "owner-1";
const VIEWER = "viewer-2";

function publishedPublicProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Robot Arm",
    slug: "robot-arm",
    status: "published",
    visibility: "public",
    userId: OWNER,
    organizationId: null,
    ...overrides,
  };
}

beforeEach(() => {
  projectRows = [];
  bundledRows = [];
  assetRows = [];
  mockIsOrgMember.mockReset();
  mockIsOrgMember.mockResolvedValue({ member: false, role: null });
});

describe("loadProjectPrintTiles", () => {
  it("returns null when the project does not exist", async () => {
    projectRows = [];
    expect(await loadProjectPrintTiles("missing", VIEWER)).toBeNull();
  });

  it("hides a draft project from a non-owner", async () => {
    projectRows = [publishedPublicProject({ status: "draft" })];
    expect(await loadProjectPrintTiles("robot-arm", VIEWER)).toBeNull();
  });

  it("hides a private project from a non-owner", async () => {
    projectRows = [publishedPublicProject({ visibility: "private" })];
    expect(await loadProjectPrintTiles("robot-arm", VIEWER)).toBeNull();
  });

  it("lets the owner load a draft project", async () => {
    projectRows = [publishedPublicProject({ status: "draft" })];
    bundledRows = [];
    const ctx = await loadProjectPrintTiles("robot-arm", OWNER);
    expect(ctx).not.toBeNull();
    expect(ctx!.projectName).toBe("Robot Arm");
    expect(ctx!.tiles).toEqual([]);
  });

  it("filters unpublished bundled files for non-owners but keeps order", async () => {
    projectRows = [publishedPublicProject()];
    bundledRows = [
      { id: "f1", name: "Base", slug: "base", thumbnailUrl: "t1", status: "published", position: 0 },
      { id: "f2", name: "Draft Part", slug: "draft-part", thumbnailUrl: "t2", status: "draft", position: 1 },
      { id: "f3", name: "Lid", slug: "lid", thumbnailUrl: "t3", status: "published", position: 2 },
    ];
    assetRows = [
      { id: "a1", fileId: "f1", format: "stl", createdAt: new Date(1) },
      { id: "a3", fileId: "f3", format: "obj", createdAt: new Date(2) },
    ];
    const ctx = await loadProjectPrintTiles("robot-arm", VIEWER);
    expect(ctx!.tiles.map((t) => t.fileAssetId)).toEqual(["a1", "a3"]);
    expect(ctx!.tiles.map((t) => t.name)).toEqual(["Base", "Lid"]);
    expect(ctx!.tiles.map((t) => t.slug)).toEqual(["base", "lid"]);
  });

  it("includes unpublished bundled files for the owner", async () => {
    projectRows = [publishedPublicProject()];
    bundledRows = [
      { id: "f1", name: "Base", slug: "base", thumbnailUrl: null, status: "published", position: 0 },
      { id: "f2", name: "Draft Part", slug: "draft-part", thumbnailUrl: null, status: "draft", position: 1 },
    ];
    assetRows = [
      { id: "a1", fileId: "f1", format: "stl", createdAt: new Date(1) },
      { id: "a2", fileId: "f2", format: "stl", createdAt: new Date(2) },
    ];
    const ctx = await loadProjectPrintTiles("robot-arm", OWNER);
    expect(ctx!.tiles.map((t) => t.fileAssetId)).toEqual(["a1", "a2"]);
  });

  it("picks the earliest-created asset per file as primary", async () => {
    projectRows = [publishedPublicProject()];
    bundledRows = [
      { id: "f1", name: "Base", slug: "base", thumbnailUrl: null, status: "published", position: 0 },
    ];
    // Loader orders assets by createdAt asc, so the first row seen for a
    // file id wins. Provide them in ascending order to mirror the query.
    assetRows = [
      { id: "a-old", fileId: "f1", format: "stl", createdAt: new Date(1) },
      { id: "a-new", fileId: "f1", format: "3mf", createdAt: new Date(2) },
    ];
    const ctx = await loadProjectPrintTiles("robot-arm", VIEWER);
    expect(ctx!.tiles).toHaveLength(1);
    expect(ctx!.tiles[0].fileAssetId).toBe("a-old");
    expect(ctx!.tiles[0].format).toBe("stl");
  });

  it("skips bundled files that have no asset", async () => {
    projectRows = [publishedPublicProject()];
    bundledRows = [
      { id: "f1", name: "Base", slug: "base", thumbnailUrl: null, status: "published", position: 0 },
      { id: "f2", name: "No Asset", slug: "no-asset", thumbnailUrl: null, status: "published", position: 1 },
    ];
    assetRows = [
      { id: "a1", fileId: "f1", format: "stl", createdAt: new Date(1) },
    ];
    const ctx = await loadProjectPrintTiles("robot-arm", VIEWER);
    expect(ctx!.tiles.map((t) => t.fileAssetId)).toEqual(["a1"]);
  });
});
