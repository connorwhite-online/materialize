import { describe, it, expect, vi, beforeEach } from "vitest";

// MTR-241: `deleteFilePhoto` used to delete the R2 object BEFORE the
// DB row, with no try/catch around the storage call. An R2 error
// aborted before the row was removed; a DB failure after a successful
// R2 delete stranded a row pointing at missing bytes (a broken tile).
// The fix flips the order — DB row first, then a best-effort,
// guarded storage cleanup that never fails the action.

let photoRow: {
  id: string;
  storageKey: string;
  fileId: string;
  authorId: string;
  fileUserId: string;
  fileSlug: string;
} | null = null;

const { deleteObject, dbDeleteWhere, logError } = vi.hoisted(() => ({
  deleteObject: vi.fn(async () => {}),
  dbDeleteWhere: vi.fn(async () => {}),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => (photoRow ? [photoRow] : []),
        }),
      }),
    }),
    delete: () => ({
      where: () => dbDeleteWhere(),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  filePhotos: { id: "id", userId: "user_id", storageKey: "storage_key", fileId: "file_id" },
  files: { id: "id", userId: "user_id", slug: "slug" },
  users: {},
}));

vi.mock("@/lib/storage", () => ({ deleteObject }));
vi.mock("@/lib/entitlement", () => ({ userHasUsedFile: vi.fn() }));
vi.mock("@/lib/notifications/notify", () => ({ notifyBuildOnFile: vi.fn() }));
vi.mock("@/lib/notifications/types", () => ({ makeSnippet: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logError,
  isRedirectError: () => false,
}));

import { deleteFilePhoto } from "../photos";

beforeEach(() => {
  vi.clearAllMocks();
  photoRow = {
    id: "photo-1",
    storageKey: "photos/test-user-id/photo-1.jpg",
    fileId: "file-1",
    authorId: "test-user-id",
    fileUserId: "test-user-id",
    fileSlug: "gear-bracket",
  };
});

describe("deleteFilePhoto (MTR-241)", () => {
  it("still returns success when the R2 delete throws — the row delete happened", async () => {
    deleteObject.mockRejectedValueOnce(new Error("R2 down"));

    const result = await deleteFilePhoto("photo-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("photos/test-user-id/photo-1.jpg");
    expect(logError).toHaveBeenCalledWith("deleteFilePhoto:storage", expect.any(Error));
  });

  it("does not call deleteObject when the DB delete throws (row-first proven)", async () => {
    dbDeleteWhere.mockRejectedValueOnce(new Error("DB down"));

    const result = await deleteFilePhoto("photo-1");

    expect(result).toEqual({ error: "Failed to delete photo" });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the row and the object on the happy path", async () => {
    const result = await deleteFilePhoto("photo-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("photos/test-user-id/photo-1.jpg");
  });
});
