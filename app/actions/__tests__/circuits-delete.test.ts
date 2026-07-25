import { describe, it, expect, vi, beforeEach } from "vitest";

// MTR-241: `deleteProjectCircuit` deleted the R2 objects (source +
// preview) first, DB row second — a DB failure after a successful R2
// delete stranded a row whose serving route hard-502s on missing
// bytes. The fix flips the order: DB row first, then each storage
// key gets its own guarded best-effort delete.

let circuitRow: {
  id: string;
  projectId: string;
  sourceStorageKey: string | null;
  previewStorageKey: string | null;
  projectUserId: string;
  projectSlug: string;
} | null = null;

const { deleteObject, dbDeleteWhere, canWriteProject, logError } = vi.hoisted(
  () => ({
    deleteObject: vi.fn(async (_key: string) => {}),
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
          where: () => (circuitRow ? [circuitRow] : []),
        }),
      }),
    }),
    delete: () => ({
      where: () => dbDeleteWhere(),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projects: { id: "id", userId: "user_id", slug: "slug" },
  projectCircuits: {
    id: "id",
    projectId: "project_id",
    sourceStorageKey: "source_storage_key",
    previewStorageKey: "preview_storage_key",
  },
}));

vi.mock("@/lib/storage", () => ({ deleteObject }));
vi.mock("@/lib/authorization", () => ({ canWriteProject }));

vi.mock("@/lib/logger", () => ({
  logError,
  isRedirectError: () => false,
}));

import { deleteProjectCircuit } from "../circuits";

beforeEach(() => {
  vi.clearAllMocks();
  canWriteProject.mockResolvedValue({ ok: true });
  circuitRow = {
    id: "circuit-1",
    projectId: "project-1",
    sourceStorageKey: "circuits/test-user-id/circuit-1-source.png",
    previewStorageKey: "circuits/test-user-id/circuit-1-preview.png",
    projectUserId: "test-user-id",
    projectSlug: "robot-arm",
  };
});

describe("deleteProjectCircuit (MTR-241)", () => {
  it("still returns success when an R2 delete throws — the row delete happened", async () => {
    deleteObject.mockRejectedValueOnce(new Error("R2 down"));

    const result = await deleteProjectCircuit("circuit-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      "deleteProjectCircuit:storage",
      expect.any(Error)
    );
  });

  it("does not call deleteObject when the DB delete throws (row-first proven)", async () => {
    dbDeleteWhere.mockRejectedValueOnce(new Error("DB down"));

    const result = await deleteProjectCircuit("circuit-1");

    expect(result).toEqual({ error: "Failed to delete diagram" });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("guards each of source + preview keys independently — one throwing doesn't skip the other", async () => {
    deleteObject.mockImplementation(async (key: string) => {
      if (key.includes("source")) throw new Error("source R2 fail");
    });

    const result = await deleteProjectCircuit("circuit-1");

    expect(result).toEqual({ success: true });
    expect(deleteObject).toHaveBeenCalledWith(
      "circuits/test-user-id/circuit-1-source.png"
    );
    expect(deleteObject).toHaveBeenCalledWith(
      "circuits/test-user-id/circuit-1-preview.png"
    );
  });

  it("deletes the row and both objects on the happy path", async () => {
    const result = await deleteProjectCircuit("circuit-1");

    expect(result).toEqual({ success: true });
    expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });
});
