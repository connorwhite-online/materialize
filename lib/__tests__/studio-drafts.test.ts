import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * promoteStudioDraftsForAssets (MTR-178, docs/text-to-cad/05 §B): "an
 * order is a save" — ordered studio drafts flip to published (visibility
 * untouched, source stays 'studio'), and their never-saved thread adopts
 * the promoted file as savedFileId. Best-effort: DB failures are logged,
 * never thrown (the caller just created an order).
 */

vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    __name: "cad_generations",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    threadId: "thread_id",
  },
  cadThreads: {
    __name: "cad_threads",
    id: "id",
    userId: "user_id",
    savedFileId: "saved_file_id",
  },
  files: {
    __name: "files",
    id: "id",
    userId: "user_id",
    status: "status",
    source: "source",
  },
  fileAssets: { __name: "file_assets", id: "id", fileId: "file_id" },
}));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logError(...args),
}));

type Row = Record<string, unknown>;
let selectQueue: Row[][] = [];
let updateReturningQueue: Row[][] = [];
const updates: { table: { __name: string }; values: Row }[] = [];

function selectChain() {
  const rows = Promise.resolve(selectQueue.shift() ?? []);
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
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
          const p = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<Row[]>;
          };
          p.returning = () =>
            Promise.resolve(updateReturningQueue.shift() ?? []);
          return p;
        },
      }),
    }),
  },
}));

import { promoteStudioDraftsForAssets } from "@/lib/studio-drafts";

const updatesTo = (name: string) =>
  updates.filter((u) => u.table.__name === name).map((u) => u.values);

describe("promoteStudioDraftsForAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    updateReturningQueue = [];
    updates.length = 0;
  });

  it("publishes ordered studio drafts and adopts them as the thread's saved file", async () => {
    selectQueue = [
      [{ id: "asset-A", fileId: "file-A" }], // assets → files
      [{ fileAssetId: "asset-A", threadId: "thread-1" }], // generations
    ];
    updateReturningQueue = [[{ id: "file-A" }]]; // files promoted

    await promoteStudioDraftsForAssets({
      userId: "user-1",
      fileAssetIds: ["asset-A", null, "asset-A"],
    });

    // Status flips to published; visibility and source untouched.
    const fileUpdates = updatesTo("files");
    expect(fileUpdates).toEqual([
      expect.objectContaining({ status: "published" }),
    ]);
    expect(fileUpdates[0]).not.toHaveProperty("visibility");
    expect(fileUpdates[0]).not.toHaveProperty("source");

    // Thread adopts the promoted file (WHERE savedFileId IS NULL is in the
    // query — asserted by behavior in prod, recorded values here).
    expect(updatesTo("cad_threads")).toEqual([
      expect.objectContaining({ savedFileId: "file-A" }),
    ]);
  });

  it("no-ops (no thread writes) when nothing was actually promoted", async () => {
    selectQueue = [[{ id: "asset-A", fileId: "file-A" }]];
    updateReturningQueue = [[]]; // already published / not studio

    await promoteStudioDraftsForAssets({
      userId: "user-1",
      fileAssetIds: ["asset-A"],
    });

    expect(updatesTo("cad_threads")).toEqual([]);
  });

  it("does nothing for an empty asset list", async () => {
    await promoteStudioDraftsForAssets({ userId: "user-1", fileAssetIds: [] });
    expect(updates).toHaveLength(0);
  });

  it("swallows and logs DB failures (must never fail the order)", async () => {
    // Reach the files update, then have it blow up.
    selectQueue = [[{ id: "asset-A", fileId: "file-A" }]];
    const { db } = await import("@/lib/db");
    const spy = vi.spyOn(db, "update").mockImplementation(
      () =>
        ({
          set: () => ({
            where: () => ({
              returning: () => Promise.reject(new Error("db down")),
            }),
          }),
        }) as never
    );

    await expect(
      promoteStudioDraftsForAssets({
        userId: "user-1",
        fileAssetIds: ["asset-A"],
      })
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      "promoteStudioDraftsForAssets",
      expect.any(Error)
    );
    spy.mockRestore();
  });
});
