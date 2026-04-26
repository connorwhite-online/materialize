import { describe, it, expect, vi, beforeEach } from "vitest";

// Configurable per-test responses for the various select() chains.
let ownedFilesResponse: Array<{ id: string }> = [];
let projectFetchResponse: Array<Record<string, unknown>> = [];
let buyerRowsResponse: Array<{ id: string }> = [];
const insertedProjects: Array<Record<string, unknown>> = [];
const insertedProjectFiles: Array<Record<string, unknown>> = [];
const insertedRouter: { latestTable: string | null } = { latestTable: null };

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: { __name?: string }) => {
      // Track which table was last inserted into via a tag on the
      // schema mock below.
      insertedRouter.latestTable = table.__name ?? null;
      return {
        values: (vals: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (insertedRouter.latestTable === "projects") {
            insertedProjects.push(vals as Record<string, unknown>);
            return {
              returning: () => [
                {
                  id: "test-project-id",
                  slug: "chess-set-abc123",
                  userId: "test-user-id",
                  name: (vals as Record<string, unknown>).name,
                  visibility: "public",
                },
              ],
            };
          }
          if (insertedRouter.latestTable === "project_files") {
            const arr = Array.isArray(vals) ? vals : [vals];
            insertedProjectFiles.push(...arr);
            return Promise.resolve();
          }
          return Promise.resolve();
        },
      };
    },
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "files") return ownedFilesResponse;
          if (table.__name === "projects") return projectFetchResponse;
          if (table.__name === "purchases") return buyerRowsResponse;
          return [];
        },
        innerJoin: () => ({ where: () => [] }),
        leftJoin: () => ({ where: () => [] }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projects: { __name: "projects", id: "id", userId: "user_id", slug: "slug" },
  projectFiles: {
    __name: "project_files",
    projectId: "project_id",
    fileId: "file_id",
  },
  files: { __name: "files", id: "id", userId: "user_id" },
  purchases: {
    __name: "purchases",
    id: "id",
    fileId: "file_id",
    projectId: "project_id",
    status: "status",
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import {
  createProject,
  deleteProject,
} from "../projects";

describe("createProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownedFilesResponse = [];
    insertedProjects.length = 0;
    insertedProjectFiles.length = 0;
  });

  // Real UUIDs (v4 with correct variant nibble) — validation schema
  // expects z.string().uuid().
  const FILE_1 = "11111111-1111-4111-8111-111111111111";
  const FILE_2 = "22222222-2222-4222-8222-222222222222";

  it("rejects when fileIds reference files the caller doesn't own", async () => {
    // Caller is mocked as test-user-id (vitest.setup.ts). The owned-files
    // query returns 1 row when 2 IDs were requested → mismatch.
    ownedFilesResponse = [{ id: FILE_1 }];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "free");
    formData.append("fileIds", FILE_1);
    formData.append("fileIds", FILE_2);

    const result = await createProject(formData);
    expect(result).toBeDefined();
    expect((result as { error?: unknown }).error).toBeTruthy();
    expect(insertedProjects.length).toBe(0);
  });

  it("inserts project + project_files rows on success", async () => {
    ownedFilesResponse = [{ id: FILE_1 }, { id: FILE_2 }];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "free");
    formData.append("fileIds", FILE_1);
    formData.append("fileIds", FILE_2);

    let threw: unknown;
    let returned: unknown;
    try {
      returned = await createProject(formData);
    } catch (err) {
      // createProject calls redirect() on success, which the
      // navigation mock turns into a thrown REDIRECT: error.
      threw = err;
    }
    if (!threw) {
      // Diagnostic — surfaces validation/auth errors when redirect path
      // wasn't taken.
      throw new Error(
        `expected redirect, got returned=${JSON.stringify(returned)}`
      );
    }
    expect((threw as Error).message).toContain("REDIRECT:/projects/");
    expect(insertedProjects.length).toBe(1);
    expect(insertedProjectFiles.length).toBe(2);
    expect(insertedProjectFiles[0]).toMatchObject({
      projectId: "test-project-id",
      fileId: FILE_1,
      position: 0,
    });
    expect(insertedProjectFiles[1]).toMatchObject({
      projectId: "test-project-id",
      fileId: FILE_2,
      position: 1,
    });
  });
});

describe("deleteProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFetchResponse = [
      { id: "test-project-id", slug: "chess-set-abc123", userId: "test-user-id" },
    ];
    buyerRowsResponse = [];
  });

  it("hard-deletes when there are no buyers", async () => {
    buyerRowsResponse = [];
    const result = await deleteProject("test-project-id");
    expect(result).toEqual({ deleted: true });
  });

  it("soft-archives when there are buyers", async () => {
    buyerRowsResponse = [{ id: "purchase-1" }, { id: "purchase-2" }];
    const result = await deleteProject("test-project-id");
    expect(result).toMatchObject({
      archived: true,
      reason: "has-buyers",
      buyerCount: 2,
    });
  });
});
