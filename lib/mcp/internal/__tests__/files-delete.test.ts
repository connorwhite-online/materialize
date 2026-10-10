import { describe, it, expect, vi, beforeEach } from "vitest";

// materialize_delete_file used to hard-delete whenever the caller's own
// orders didn't reference the asset, cascading other people's purchases,
// carts and in-flight print orders away. It now shares the web
// deleteFileListing gate (lib/files/delete-guard.ts). Also pins the
// handler-side input caps that stand in for schema limits (the MCP
// schemas are frozen for the ChatGPT plugin review).

const { state } = vi.hoisted(() => ({
  state: {
    // Each db.select() chain resolves to the next entry.
    selectQueue: [] as unknown[][],
    limits: [] as number[],
    updates: [] as Array<Record<string, unknown>>,
    deletes: 0,
    blocker: null as null | { reason: "has-buyers" | "in-flight"; count: number },
    archived: [] as string[],
  },
}));

function selectChain() {
  const rows = state.selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = (n: number) => {
    state.limits.push(n);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        state.updates.push(vals);
        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => {
        state.deletes++;
        return Promise.resolve();
      },
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  fileAssets: {},
  filePhotos: {},
  files: {},
  printOrders: {},
  printOrderItems: {},
  users: {},
}));
vi.mock("@/lib/files/delete-guard", () => ({
  findFileDeleteBlocker: async () => state.blocker,
  archiveFileListingRow: async (fileId: string) => {
    state.archived.push(fileId);
  },
}));
vi.mock("@/lib/studio-drafts", () => ({
  notUnsavedStudioDraft: () => true,
}));
vi.mock("@/lib/craftcloud/client", () => ({ uploadModel: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  deleteObject: vi.fn(),
  generateUploadUrl: vi.fn(),
  objectExists: vi.fn(),
  putObject: vi.fn(),
}));

import {
  deleteFileForUser,
  listFilesForUser,
  MAX_LISTED_FILES,
  updateFileForUser,
} from "../files";
import { MAX_PRICE_CENTS } from "@/lib/validations/file";

const OWNED_ASSET = { assetId: "asset-1", ownerId: "user-1", fileId: "file-1" };

beforeEach(() => {
  state.selectQueue = [];
  state.limits = [];
  state.updates = [];
  state.deletes = 0;
  state.blocker = null;
  state.archived = [];
});

describe("deleteFileForUser", () => {
  it("archives instead of deleting when someone bought the file", async () => {
    state.selectQueue = [[OWNED_ASSET]];
    state.blocker = { reason: "has-buyers", count: 3 };
    const result = await deleteFileForUser({ userId: "user-1", fileAssetId: "asset-1" });
    expect(result).toEqual({ ok: true, archived: true, reason: "has-buyers", count: 3 });
    expect(state.archived).toEqual(["file-1"]);
    expect(state.deletes).toBe(0);
  });

  it("archives instead of deleting when another user's order is in flight", async () => {
    state.selectQueue = [[OWNED_ASSET]];
    state.blocker = { reason: "in-flight", count: 1 };
    const result = await deleteFileForUser({ userId: "user-1", fileAssetId: "asset-1" });
    expect(result).toMatchObject({ archived: true, reason: "in-flight" });
    expect(state.deletes).toBe(0);
  });

  it("still refuses when a settled order references the asset", async () => {
    state.selectQueue = [[OWNED_ASSET], [{ id: "order-1" }], []];
    const result = await deleteFileForUser({ userId: "user-1", fileAssetId: "asset-1" });
    expect(result).toHaveProperty("error");
    expect(state.deletes).toBe(0);
  });

  it("hard-deletes a file nothing depends on", async () => {
    state.selectQueue = [[OWNED_ASSET], [], []];
    const result = await deleteFileForUser({ userId: "user-1", fileAssetId: "asset-1" });
    expect(result).toEqual({ ok: true, archived: false });
    expect(state.deletes).toBe(1);
    expect(state.archived).toEqual([]);
  });

  it("refuses another user's file without consulting the gate", async () => {
    state.selectQueue = [[{ ...OWNED_ASSET, ownerId: "someone-else" }]];
    state.blocker = { reason: "has-buyers", count: 1 };
    const result = await deleteFileForUser({ userId: "user-1", fileAssetId: "asset-1" });
    expect(result).toEqual({ error: "File not found" });
    expect(state.archived).toEqual([]);
  });
});

describe("listFilesForUser", () => {
  it("caps the listing at MAX_LISTED_FILES", async () => {
    state.selectQueue = [[]];
    await listFilesForUser("user-1");
    expect(state.limits).toEqual([MAX_LISTED_FILES]);
  });
});

describe("file metadata price normalization", () => {
  const OWNED_FILE = { id: "file-1", userId: "user-1", slug: "f" };

  it("clamps an oversized price to MAX_PRICE_CENTS", async () => {
    state.selectQueue = [[OWNED_FILE]];
    await updateFileForUser({
      userId: "user-1",
      fileId: "file-1",
      metadata: { priceCents: MAX_PRICE_CENTS + 1 },
    });
    expect(state.updates).toEqual([{ price: MAX_PRICE_CENTS }]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores a %s price",
    async (priceCents) => {
      state.selectQueue = [[OWNED_FILE]];
      await updateFileForUser({
        userId: "user-1",
        fileId: "file-1",
        metadata: { priceCents },
      });
      expect(state.updates).toEqual([]);
    }
  );
});
