import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * saveCadFileToProfile / deleteCadBuild lifecycle semantics (MTR-178,
 * docs/text-to-cad/05 §C/§E): first save publishes + records the thread's
 * savedFileId; re-save re-points the SAVED file at the new generation's
 * asset (one file per design) when safe, and falls back to
 * publish-new/demote-old when order references or assemblies make the
 * re-point unsafe; deleteCadBuild sweeps render/topo R2 objects and the
 * thread row.
 */

let allowed = true;

vi.mock("@/lib/features", () => ({
  canUseTextToCad: vi.fn(() => allowed),
}));

// cad-generation.ts imports the harness + persist modules at top level;
// stub them so this test doesn't drag the whole generation stack in.
vi.mock("@/lib/cad/harness", () => ({ runHarness: vi.fn() }));
vi.mock("@/lib/cad/persist", () => ({
  persistGenerationFailure: vi.fn(),
  persistGenerationSuccess: vi.fn(),
}));

const { deleteObject } = vi.hoisted(() => ({
  deleteObject: vi.fn((_key: string) => Promise.resolve()),
}));
vi.mock("@/lib/storage", () => ({ deleteObject }));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logError(...args),
}));

// Table stubs — identity is what the db mock records, so tests can assert
// WHICH table an update/delete hit.
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    __name: "cad_generations",
    id: "id",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    parentGenerationId: "parent_generation_id",
    threadId: "thread_id",
    projectId: "project_id",
    createdAt: "created_at",
    renderStorageKey: "render_storage_key",
    topoStorageKey: "topo_storage_key",
    title: "title",
    rating: "rating",
    feedbackTags: "feedback_tags",
    feedbackNote: "feedback_note",
    feedbackAt: "feedback_at",
    sourceCode: "source_code",
    status: "status",
  },
  cadThreads: {
    __name: "cad_threads",
    id: "id",
    userId: "user_id",
    savedFileId: "saved_file_id",
    title: "title",
  },
  files: {
    __name: "files",
    id: "id",
    userId: "user_id",
    status: "status",
    source: "source",
    slug: "slug",
    name: "name",
  },
  fileAssets: { __name: "file_assets", id: "id", fileId: "file_id" },
  printOrders: { __name: "print_orders", id: "id", fileAssetId: "file_asset_id" },
  printOrderItems: {
    __name: "print_order_items",
    id: "id",
    fileAssetId: "file_asset_id",
  },
  cartItems: { __name: "cart_items", id: "id", fileAssetId: "file_asset_id" },
  projectFiles: { __name: "project_files", fileId: "file_id" },
}));

// --- db mock: selects resolve FIFO from `selectQueue`; updates/deletes are
// recorded with their table stub so assertions can name tables. ---
type Row = Record<string, unknown>;
let selectQueue: Row[][] = [];
const updates: { table: { __name: string }; values: Row }[] = [];
const deletes: { table: { __name: string } }[] = [];

function selectChain() {
  const rows = Promise.resolve(selectQueue.shift() ?? []);
  const c: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin", "where", "orderBy", "limit"]) {
    c[m] = () => c;
  }
  c.then = (
    onFulfilled?: (v: Row[]) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => rows.then(onFulfilled, onRejected);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    update: (table: { __name: string }) => ({
      set: (values: Row) => ({
        where: () => {
          updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: () => {
        deletes.push({ table });
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
  },
}));

import {
  saveCadFileToProfile,
  deleteCadBuild,
} from "@/app/actions/cad-generation";

const updatesTo = (name: string) =>
  updates.filter((u) => u.table.__name === name).map((u) => u.values);

describe("saveCadFileToProfile (one file per design, 05 §C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed = true;
    selectQueue = [];
    updates.length = 0;
    deletes.length = 0;
  });

  it("first save publishes the file (private) and records the thread's savedFileId", async () => {
    selectQueue = [
      [{ fileId: "file-A", ownerId: "test-user-id" }], // asset → file
      [{ id: "gen-2", threadId: "thread-1", projectId: null }], // generation
      [{ id: "thread-1", savedFileId: null }], // thread (never saved)
    ];

    const res = await saveCadFileToProfile({ fileAssetId: "asset-A" });
    expect(res).toEqual({ ok: true });

    expect(updatesTo("files")).toEqual([
      expect.objectContaining({ status: "published", visibility: "private" }),
    ]);
    expect(updatesTo("cad_threads")).toEqual([
      expect.objectContaining({
        savedFileId: "file-A",
        activeGenerationId: "gen-2",
      }),
    ]);
  });

  it("re-save of an already-saved design re-points the saved file's asset (slug stable)", async () => {
    selectQueue = [
      [{ fileId: "file-B", ownerId: "test-user-id" }], // new generation's file
      [{ id: "gen-3", threadId: "thread-1", projectId: null }],
      [{ id: "thread-1", savedFileId: "file-A" }], // saved earlier as file-A
      [{ id: "file-A", source: "studio" }], // prior saved file exists
      [{ id: "asset-A" }], // saved file's assets
      [], // printOrders refs
      [], // printOrderItems refs
      [], // cartItems refs
      [], // projectFiles refs
    ];

    const res = await saveCadFileToProfile({ fileAssetId: "asset-B" });
    expect(res).toEqual({ ok: true });

    // Swap, crash-safe order: the NEW asset attaches to the saved file
    // first (a crash mid-swap leaves two assets — stale but working), then
    // the old assets park on the draft file — each file ends with one asset.
    expect(updatesTo("file_assets")).toEqual([
      expect.objectContaining({ fileId: "file-A" }),
      expect.objectContaining({ fileId: "file-B" }),
    ]);
    // The saved file stays published; NO second file is published.
    expect(updatesTo("files")).toEqual([
      expect.objectContaining({ status: "published" }),
    ]);
    // Thread keeps its savedFileId (unchanged) but tracks the new active
    // generation.
    const threadUpdates = updatesTo("cad_threads");
    expect(threadUpdates).toEqual([
      expect.objectContaining({ activeGenerationId: "gen-3" }),
    ]);
    expect(threadUpdates[0]).not.toHaveProperty("savedFileId");
  });

  it("falls back to publish-new/demote-old when the saved file's asset is order-referenced", async () => {
    selectQueue = [
      [{ fileId: "file-B", ownerId: "test-user-id" }],
      [{ id: "gen-3", threadId: "thread-1", projectId: null }],
      [{ id: "thread-1", savedFileId: "file-A" }],
      [{ id: "file-A", source: "studio" }],
      [{ id: "asset-A" }],
      [{ id: "order-1" }], // printOrders reference → never re-point
    ];

    const res = await saveCadFileToProfile({ fileAssetId: "asset-B" });
    expect(res).toEqual({ ok: true });

    // No asset rows were touched — ordered geometry is immutable.
    expect(updatesTo("file_assets")).toEqual([]);
    // New file published, old studio file demoted back to draft.
    expect(updatesTo("files")).toEqual([
      expect.objectContaining({ status: "published", visibility: "private" }),
      expect.objectContaining({ status: "draft" }),
    ]);
    // Thread re-points its savedFileId at the new file.
    expect(updatesTo("cad_threads")).toEqual([
      expect.objectContaining({
        savedFileId: "file-B",
        activeGenerationId: "gen-3",
      }),
    ]);
  });

  it("assemblies (generation with a projectId) never re-point part files", async () => {
    selectQueue = [
      [{ fileId: "file-B", ownerId: "test-user-id" }],
      [{ id: "gen-3", threadId: "thread-1", projectId: "project-7" }],
      [{ id: "thread-1", savedFileId: "file-A" }],
      [{ id: "file-A", source: "studio" }],
      [{ id: "asset-A" }],
      [], // printOrders
      [], // printOrderItems
      [], // cartItems
      [], // projectFiles
    ];

    const res = await saveCadFileToProfile({ fileAssetId: "asset-B" });
    expect(res).toEqual({ ok: true });
    expect(updatesTo("file_assets")).toEqual([]);
    expect(updatesTo("cad_threads")).toEqual([
      expect.objectContaining({ savedFileId: "file-B" }),
    ]);
  });

  it("legacy generation with no thread keeps the plain publish behavior", async () => {
    selectQueue = [
      [{ fileId: "file-A", ownerId: "test-user-id" }],
      [], // no generation row
    ];

    const res = await saveCadFileToProfile({ fileAssetId: "asset-A" });
    expect(res).toEqual({ ok: true });
    expect(updatesTo("files")).toEqual([
      expect.objectContaining({ status: "published", visibility: "private" }),
    ]);
    expect(updatesTo("cad_threads")).toEqual([]);
  });

  it("rejects saving another user's asset", async () => {
    selectQueue = [[{ fileId: "file-A", ownerId: "someone-else" }]];
    const res = await saveCadFileToProfile({ fileAssetId: "asset-A" });
    expect(res).toEqual({ error: "Model not found." });
    expect(updates).toHaveLength(0);
  });
});

describe("deleteCadBuild R2 + thread cleanup (05 §E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed = true;
    selectQueue = [];
    updates.length = 0;
    deletes.length = 0;
  });

  it("deletes render/topo objects and the thread row when its last generation goes", async () => {
    selectQueue = [
      [
        {
          id: "gen-1",
          renderStorageKey: "cad-renders/u/a.png",
          topoStorageKey: "cad-topo/u/a.json",
          threadId: "thread-1",
        },
        {
          id: "gen-2",
          renderStorageKey: "cad-renders/u/b.png",
          topoStorageKey: null,
          threadId: "thread-1",
        },
      ],
      [], // no generations remain on thread-1
    ];

    const res = await deleteCadBuild({ generationIds: ["gen-1", "gen-2"] });
    expect(res).toEqual({ ok: true });

    expect(deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual([
      "cad-renders/u/a.png",
      "cad-renders/u/b.png",
      "cad-topo/u/a.json",
    ]);
    expect(deletes.map((d) => d.table.__name)).toEqual([
      "cad_generations",
      "cad_threads",
    ]);
  });

  it("keeps the thread row while it still has generations", async () => {
    selectQueue = [
      [
        {
          id: "gen-2",
          renderStorageKey: null,
          topoStorageKey: null,
          threadId: "thread-1",
        },
      ],
      [{ id: "gen-1" }], // thread-1 still has a generation
    ];

    const res = await deleteCadBuild({ generationIds: ["gen-2"] });
    expect(res).toEqual({ ok: true });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deletes.map((d) => d.table.__name)).toEqual(["cad_generations"]);
  });
});
