import { describe, it, expect, vi, beforeEach } from "vitest";

// MTR-241: `deleteProjectPhoto` deleted the R2 object first (best
// effort) and the DB row second — so a DB failure after a successful
// R2 delete stranded the row pointing at missing bytes (a broken
// gallery tile). The fix flips the order: DB row first, storage
// cleanup best-effort second.

let photoRow: {
  id: string;
  storageKey: string;
  projectId: string;
  authorId: string;
  projectUserId: string;
  projectSlug: string;
} | null = null;

const { deleteObject, dbDeleteWhere, canWriteProject, logError } = vi.hoisted(
  () => ({
    deleteObject: vi.fn(async () => {}),
    dbDeleteWhere: vi.fn(async () => {}),
    canWriteProject: vi.fn(async () => ({ ok: true })),
    logError: vi.fn(),
  })
);

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
  projectPhotos: {
    id: "id",
    userId: "user_id",
    storageKey: "storage_key",
    projectId: "project_id",
  },
  projects: { id: "id", userId: "user_id", slug: "slug" },
}));

vi.mock("@/lib/storage", () => ({ deleteObject }));
vi.mock("@/lib/entitlement", () => ({ userOwnsProject: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ canWriteProject }));

vi.mock("@/lib/logger", () => ({
  logError,
  isRedirectError: () => false,
}));

import { deleteProjectPhoto } from "../project-photos";

beforeEach(() => {
  vi.clearAllMocks();
  canWriteProject.mockResolvedValue({ ok: true });
  photoRow = {
    id: "photo-1",
    storageKey: "photos/test-user-id/photo-1.jpg",
    projectId: "project-1",
    authorId: "test-user-id",
    projectUserId: "test-user-id",
    projectSlug: "robot-arm",
  };
});

describe("deleteProjectPhoto (MTR-241)", () => {
  it("still returns success when the R2 delete throws — the row delete happened", async () => {
    deleteObject.mockRejectedValueOnce(new Error("R2 down"));

    const result = await deleteProjectPhoto("photo-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("photos/test-user-id/photo-1.jpg");
    expect(logError).toHaveBeenCalledWith(
      "deleteProjectPhoto:storage",
      expect.any(Error)
    );
  });

  it("does not call deleteObject when the DB delete throws (row-first proven)", async () => {
    dbDeleteWhere.mockRejectedValueOnce(new Error("DB down"));

    const result = await deleteProjectPhoto("photo-1");

    expect(result).toEqual({ error: "Failed to delete photo" });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the row and the object on the happy path", async () => {
    const result = await deleteProjectPhoto("photo-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("photos/test-user-id/photo-1.jpg");
  });
});
