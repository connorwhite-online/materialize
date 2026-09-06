import { describe, it, expect, vi, beforeEach } from "vitest";

// Configurable per-test responses for the various select() chains.
// Files rows now carry organizationId so the new viewerCanAttachAllFiles
// path in lib/authorization.ts can resolve "this row is owned by the
// viewer" without consulting org membership for personal-only tests.
let ownedFilesResponse: Array<{
  id: string;
  userId?: string;
  organizationId?: string | null;
}> = [];
let projectFetchResponse: Array<Record<string, unknown>> = [];
let buyerRowsResponse: Array<{ id: string }> = [];
let orgMembersResponse: Array<{ organizationId: string; role?: string }> = [];
const insertedProjects: Array<Record<string, unknown>> = [];
const insertedProjectFiles: Array<Record<string, unknown>> = [];
// MTR-235: forces the project_files insert inside createProject's
// db.transaction to throw, so tests can assert the transaction rolls
// back (no orphaned `projects` row) instead of just checking the
// error is surfaced.
let projectFilesInsertShouldReject = false;

// Wraps an array in the chainable shape Drizzle's select returns
// (so `.limit()` works after `.where()`) without abandoning the
// "return value is iterable / destructurable" contract callers rely
// on. Used everywhere the new auth-helper code paths do `.limit(1)`.
function chainable<T>(arr: T[]) {
  return Object.assign(arr, {
    limit: () => arr,
  });
}

// Shared insert-routing logic used both by the top-level `db.insert`
// (for actions that don't need a transaction) and by the buffered
// `tx.insert` inside `db.transaction` below. `commit(vals)` is how
// the caller decides whether a given table's write actually lands in
// the "real" insertedProjects / insertedProjectFiles trackers.
function makeInsert(
  commitProject: (vals: Record<string, unknown>) => void,
  commitProjectFiles: (vals: Array<Record<string, unknown>>) => void
) {
  const router: { latestTable: string | null } = { latestTable: null };
  return (table: { __name?: string }) => {
    router.latestTable = table.__name ?? null;
    return {
      values: (
        vals: Record<string, unknown> | Array<Record<string, unknown>>
      ) => {
        if (router.latestTable === "projects") {
          commitProject(vals as Record<string, unknown>);
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
        if (router.latestTable === "project_files") {
          if (projectFilesInsertShouldReject) {
            throw new Error("FK violation: file no longer exists");
          }
          const arr = Array.isArray(vals) ? vals : [vals];
          commitProjectFiles(arr);
          // addFilesToProject chains .onConflictDoNothing() after
          // .values(...); createProject's tx path does not and just
          // awaits the .values(...) call directly. Support both by
          // returning an already-resolved, awaitable promise that also
          // exposes a chainable onConflictDoNothing().
          const resolved = Promise.resolve();
          return Object.assign(resolved, {
            onConflictDoNothing: () => Promise.resolve(),
          });
        }
        return Promise.resolve();
      },
    };
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    insert: makeInsert(
      (vals) => insertedProjects.push(vals),
      (vals) => insertedProjectFiles.push(...vals)
    ),
    // Buffers writes locally and only merges them into the shared
    // insertedProjects / insertedProjectFiles trackers if the callback
    // resolves — mirroring real transaction rollback so MTR-235's
    // "no orphaned project row on failure" test is meaningful rather
    // than just checking the error is returned.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const bufferedProjects: Array<Record<string, unknown>> = [];
      const bufferedProjectFiles: Array<Record<string, unknown>> = [];
      const tx = {
        insert: makeInsert(
          (vals) => bufferedProjects.push(vals),
          (vals) => bufferedProjectFiles.push(...vals)
        ),
      };
      const result = await cb(tx);
      insertedProjects.push(...bufferedProjects);
      insertedProjectFiles.push(...bufferedProjectFiles);
      return result;
    },
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "files") return chainable(ownedFilesResponse);
          if (table.__name === "projects") return chainable(projectFetchResponse);
          if (table.__name === "purchases") return chainable(buyerRowsResponse);
          if (table.__name === "organization_members")
            return chainable(orgMembersResponse);
          return chainable([]);
        },
        innerJoin: () => ({ where: () => chainable([]) }),
        leftJoin: () => ({ where: () => chainable([]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {
    __name: "projects",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
    slug: "slug",
  },
  projectFiles: {
    __name: "project_files",
    projectId: "project_id",
    fileId: "file_id",
  },
  files: {
    __name: "files",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
  },
  purchases: {
    __name: "purchases",
    id: "id",
    fileId: "file_id",
    projectId: "project_id",
    status: "status",
  },
  collections: { __name: "collections", id: "id", userId: "user_id" },
  printOrders: { __name: "print_orders", id: "id", userId: "user_id" },
  organizationMembers: {
    __name: "organization_members",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
    role: "role",
  },
  organizations: { __name: "organizations", id: "id", slug: "slug" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: (e: unknown) =>
    e instanceof Error &&
    (e.message.includes("NEXT_REDIRECT") || e.message.includes("REDIRECT")),
}));

import { updateTag } from "next/cache";

import {
  createProject,
  deleteProject,
  addFilesToProject,
  removeFileFromProject,
} from "../projects";

describe("createProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownedFilesResponse = [];
    orgMembersResponse = [];
    insertedProjects.length = 0;
    insertedProjectFiles.length = 0;
    projectFilesInsertShouldReject = false;
  });

  // Real UUIDs (v4 with correct variant nibble) — validation schema
  // expects z.string().uuid().
  const FILE_1 = "11111111-1111-4111-8111-111111111111";
  const FILE_2 = "22222222-2222-4222-8222-222222222222";

  it("rejects when fileIds reference files the caller doesn't own", async () => {
    // Caller is mocked as test-user-id (vitest.setup.ts). The owned-files
    // query returns 1 row when 2 IDs were requested → mismatch.
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.append("fileIds", FILE_1);
    formData.append("fileIds", FILE_2);

    const result = await createProject(formData);
    expect(result).toBeDefined();
    expect((result as { error?: unknown }).error).toBeTruthy();
    expect(insertedProjects.length).toBe(0);
  });

  it("inserts project + project_files rows on success", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
      { id: FILE_2, userId: "test-user-id", organizationId: null },
    ];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
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

  it("attributes the project to an org when the viewer is a member", async () => {
    ownedFilesResponse = [
      // Files owned by a teammate, reachable through org membership.
      { id: FILE_1, userId: "other-user", organizationId: "org_team" },
      { id: FILE_2, userId: "other-user", organizationId: "org_team" },
    ];
    orgMembersResponse = [
      { organizationId: "org_team", role: "member" },
    ];

    const formData = new FormData();
    formData.set("name", "Team chess set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("organizationId", "org_team");
    formData.append("fileIds", FILE_1);
    formData.append("fileIds", FILE_2);

    let threw: unknown;
    try {
      await createProject(formData);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error)?.message).toContain("REDIRECT:/projects/");
    expect(insertedProjects[0]).toMatchObject({
      userId: "test-user-id",
      organizationId: "org_team",
    });
  });

  it("rejects when the viewer claims an org they're not in", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];
    orgMembersResponse = []; // not a member of anything

    const formData = new FormData();
    formData.set("name", "Sneaky");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("organizationId", "org_attacker");
    formData.append("fileIds", FILE_1);

    const result = await createProject(formData);
    expect(result).toBeDefined();
    expect((result as { error?: unknown }).error).toBeTruthy();
    expect(insertedProjects.length).toBe(0);
  });

  // MTR-235: the projects + project_files inserts are wrapped in
  // db.transaction so a failure between them can't leave a published,
  // publicly-visible project with zero files.
  it("rolls back the projects insert when the project_files insert fails (MTR-235)", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];
    projectFilesInsertShouldReject = true;

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.append("fileIds", FILE_1);

    const result = await createProject(formData);
    expect((result as { error?: unknown }).error).toBeTruthy();
    // Rolled back — no orphaned projects row and no project_files rows,
    // not just an error message.
    expect(insertedProjects.length).toBe(0);
    expect(insertedProjectFiles.length).toBe(0);
  });

  // MTR-236: buildGuide is sanitized before insert so the column is
  // clean for every consumer (emails, llms.txt, MCP responses), not
  // just the sanitizing render path.
  it("sanitizes buildGuide before insert (MTR-236)", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set(
      "buildGuide",
      '<p>Step 1</p><script>alert("xss")</script>'
    );
    formData.append("fileIds", FILE_1);

    let threw: unknown;
    try {
      await createProject(formData);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error)?.message).toContain("REDIRECT:/projects/");
    expect(insertedProjects.length).toBe(1);
    const buildGuide = insertedProjects[0].buildGuide as string;
    expect(buildGuide).not.toContain("<script>");
    expect(buildGuide).toContain("Step 1");
  });

  it("creates a project with zero files", async () => {
    const formData = new FormData();
    formData.set("name", "Empty shell");
    formData.set("price", "0");
    formData.set("license", "cc_by");

    let threw: unknown;
    try {
      await createProject(formData);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error)?.message).toContain("REDIRECT:/projects/");
    expect(insertedProjects.length).toBe(1);
    expect(insertedProjectFiles.length).toBe(0);
  });

  it("persists the chosen visibility", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];
    const formData = new FormData();
    formData.set("name", "Private set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.set("visibility", "private");
    formData.append("fileIds", FILE_1);

    let threw: unknown;
    try {
      await createProject(formData);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error)?.message).toContain("REDIRECT:/projects/");
    expect(insertedProjects[0]).toMatchObject({ visibility: "private" });
  });

  it("leaves an empty/undefined buildGuide untouched (MTR-236)", async () => {
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];

    const formData = new FormData();
    formData.set("name", "Chess Set");
    formData.set("price", "0");
    formData.set("license", "cc_by");
    formData.append("fileIds", FILE_1);

    let threw: unknown;
    try {
      await createProject(formData);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error)?.message).toContain("REDIRECT:/projects/");
    expect(insertedProjects[0].buildGuide).toBeUndefined();
  });
});

describe("deleteProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFetchResponse = [
      {
        id: "test-project-id",
        slug: "chess-set-abc123",
        userId: "test-user-id",
        organizationId: null,
      },
    ];
    buyerRowsResponse = [];
    orgMembersResponse = [];
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

// FIX-1: addFilesToProject / removeFileFromProject mutate project_files —
// the same table the idle-browse grid's fileNotInAnyProjectCondition()
// queries against — so both must bust the idle-browse cache tag on
// success like every other eligibility-changing mutator in this file
// (createProject, publishProject, archiveProject, deleteProject,
// toggleProjectVisibility).
describe("addFilesToProject / removeFileFromProject idle-browse cache bust", () => {
  const FILE_1 = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    projectFetchResponse = [
      {
        id: "test-project-id",
        slug: "chess-set-abc123",
        userId: "test-user-id",
        organizationId: null,
      },
    ];
    ownedFilesResponse = [
      { id: FILE_1, userId: "test-user-id", organizationId: null },
    ];
    orgMembersResponse = [];
    buyerRowsResponse = [];
  });

  it("addFilesToProject calls updateTag(IDLE_BROWSE_CACHE_TAG) on success", async () => {
    const result = await addFilesToProject("test-project-id", [FILE_1]);
    expect((result as { error?: unknown }).error).toBeUndefined();
    expect(updateTag).toHaveBeenCalledWith("idle-browse");
  });

  it("removeFileFromProject calls updateTag(IDLE_BROWSE_CACHE_TAG) on success", async () => {
    const result = await removeFileFromProject("test-project-id", FILE_1);
    expect((result as { error?: unknown }).error).toBeUndefined();
    expect(updateTag).toHaveBeenCalledWith("idle-browse");
  });
});
