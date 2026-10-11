import { describe, it, expect, vi, beforeEach } from "vitest";

// MTR-236: createProjectForUser / updateProjectForUser must sanitize
// buildGuide before persisting, the same write-time invariant the web
// server action (app/actions/projects.ts) already enforces. Uses the
// real sanitizeRichHtml implementation (only "server-only" is mocked
// globally, in vitest.setup.ts) so the assertions exercise actual
// scrubbing behavior, not a mock's approximation of it.

let ownedFilesResponse: Array<{ id: string }> = [];
let projectFetchResponse: Array<Record<string, unknown>> = [];
const insertedProjects: Array<Record<string, unknown>> = [];
const updateCalls: Array<Record<string, unknown>> = [];
let buyerRowsResponse: Array<{ id: string }> = [];
const deletedTables: string[] = [];
const insertedBomRows: Array<Record<string, unknown>> = [];

function chainable<T>(arr: T[]) {
  return Object.assign(arr, { limit: () => arr });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "files") return chainable(ownedFilesResponse);
          if (table.__name === "projects")
            return chainable(projectFetchResponse);
          if (table.__name === "purchases")
            return chainable(buyerRowsResponse);
          return chainable([]);
        },
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        if (table.__name === "project_bom_items") {
          insertedBomRows.push(...(vals as unknown as Array<Record<string, unknown>>));
          return Promise.resolve();
        }
        if (table.__name === "projects") {
          insertedProjects.push(vals);
          return {
            returning: () => [
              { id: "test-project-id", slug: "chess-set-abc123" },
            ],
          };
        }
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updateCalls.push(vals);
        return { where: () => Promise.resolve() };
      },
    }),
    delete: (table: { __name?: string }) => ({
      where: () => {
        deletedTables.push(table.__name ?? "?");
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { __name: "files", id: "id", userId: "user_id" },
  projects: {
    __name: "projects",
    id: "id",
    userId: "user_id",
    slug: "slug",
  },
  projectFiles: { __name: "project_files" },
  projectBomItems: { __name: "project_bom_items" },
  projectCircuits: { __name: "project_circuits" },
  projectPhotos: { __name: "project_photos" },
  purchases: { __name: "purchases" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import {
  createProjectForUser,
  deleteProjectForUser,
  setProjectBomForUser,
  updateProjectForUser,
} from "../projects";
import { MAX_PRICE_CENTS } from "@/lib/validations/project";

const FILE_1 = "11111111-1111-4111-8111-111111111111";
const SCRIPT_HTML = '<p>Step 1</p><script>alert("xss")</script>';

beforeEach(() => {
  vi.clearAllMocks();
  ownedFilesResponse = [{ id: FILE_1 }];
  insertedProjects.length = 0;
  updateCalls.length = 0;
  buyerRowsResponse = [];
  deletedTables.length = 0;
  insertedBomRows.length = 0;
  projectFetchResponse = [
    { id: "test-project-id", userId: "test-user-id", slug: "chess-set-abc123" },
  ];
});

describe("createProjectForUser buildGuide sanitize (MTR-236)", () => {
  it("strips a script tag before inserting", async () => {
    const result = await createProjectForUser({
      userId: "test-user-id",
      fileIds: [FILE_1],
      name: "Chess Set",
      buildGuide: SCRIPT_HTML,
    });
    expect((result as { error?: string }).error).toBeUndefined();
    expect(insertedProjects.length).toBe(1);
    const buildGuide = insertedProjects[0].buildGuide as string;
    expect(buildGuide).not.toContain("<script>");
    expect(buildGuide).toContain("Step 1");
  });

  it("leaves an undefined buildGuide as null", async () => {
    const result = await createProjectForUser({
      userId: "test-user-id",
      fileIds: [FILE_1],
      name: "Chess Set",
    });
    expect((result as { error?: string }).error).toBeUndefined();
    expect(insertedProjects[0].buildGuide).toBeNull();
  });
});

describe("updateProjectForUser buildGuide sanitize (MTR-236)", () => {
  it("strips a script tag before updating", async () => {
    const result = await updateProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
      metadata: { buildGuide: SCRIPT_HTML },
    });
    expect((result as { error?: string }).error).toBeUndefined();
    expect(updateCalls.length).toBe(1);
    const buildGuide = updateCalls[0].buildGuide as string;
    expect(buildGuide).not.toContain("<script>");
    expect(buildGuide).toContain("Step 1");
  });

  it("does not touch buildGuide when the caller doesn't submit it", async () => {
    const result = await updateProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
      metadata: { name: "Renamed" },
    });
    expect((result as { error?: string }).error).toBeUndefined();
    expect(updateCalls.length).toBe(1);
    expect("buildGuide" in updateCalls[0]).toBe(false);
  });

  it("clears buildGuide to null when the caller submits an empty string", async () => {
    const result = await updateProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
      metadata: { buildGuide: "" },
    });
    expect((result as { error?: string }).error).toBeUndefined();
    expect(updateCalls[0].buildGuide).toBeNull();
  });
});

// The MCP delete used to hard-delete unconditionally, cascading buyers'
// purchase rows away; it now shares the web deleteProject's gate.
describe("deleteProjectForUser", () => {
  it("archives instead of deleting when the project has buyers", async () => {
    buyerRowsResponse = [{ id: "purchase-1" }, { id: "purchase-2" }];
    const result = await deleteProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
    });
    expect(result).toEqual({
      ok: true,
      archived: true,
      reason: "has-buyers",
      count: 2,
    });
    expect(updateCalls).toEqual([{ status: "archived", visibility: "private" }]);
    expect(deletedTables).toEqual([]);
  });

  it("hard-deletes when nobody bought it", async () => {
    const result = await deleteProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
    });
    expect(result).toEqual({ ok: true, archived: false });
    expect(deletedTables).toEqual(["projects"]);
  });

  it("refuses someone else's project", async () => {
    const result = await deleteProjectForUser({
      userId: "someone-else",
      projectId: "test-project-id",
    });
    expect(result).toEqual({ error: "Project not found" });
    expect(deletedTables).toEqual([]);
  });
});

describe("project metadata price normalization", () => {
  it("clamps an oversized price to MAX_PRICE_CENTS", async () => {
    await updateProjectForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
      metadata: { priceCents: MAX_PRICE_CENTS * 10 },
    });
    expect(updateCalls[0].price).toBe(MAX_PRICE_CENTS);
  });

  it.each([-100, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores a %s price",
    async (priceCents) => {
      await updateProjectForUser({
        userId: "test-user-id",
        projectId: "test-project-id",
        metadata: { priceCents },
      });
      // Nothing valid to write, so no update at all.
      expect(updateCalls).toEqual([]);
    }
  );
});

describe("setProjectBomForUser sourceUrl", () => {
  it.each(["javascript:alert(1)", "data:text/html,hi", "not a url"])(
    "rejects %s before touching the BOM",
    async (sourceUrl) => {
      const result = await setProjectBomForUser({
        userId: "test-user-id",
        projectId: "test-project-id",
        items: [{ name: "M3 screw", quantity: 4, sourceUrl }],
      });
      expect(result).toEqual({
        error: 'BOM "M3 screw": sourceUrl must be an http(s) URL',
      });
      expect(deletedTables).toEqual([]);
    }
  );

  it("keeps http(s) links and treats a blank one as none", async () => {
    const result = await setProjectBomForUser({
      userId: "test-user-id",
      projectId: "test-project-id",
      items: [
        { name: "M3 screw", quantity: 4, sourceUrl: " https://example.com/m3 " },
        { name: "Magnet", quantity: 2, sourceUrl: "  " },
      ],
    });
    expect(result).toEqual({ count: 2 });
    expect(insertedBomRows.map((r) => r.sourceUrl)).toEqual([
      "https://example.com/m3",
      null,
    ]);
  });
});
