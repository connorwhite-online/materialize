import { describe, it, expect, vi, beforeEach } from "vitest";

// CON-83: replaceProjectBom moved from an owner-only check to the
// shared write set (owner OR org member OR per-project collaborator)
// via canWriteProject. These tests pin that behavior — org members and
// collaborators can now save a BOM, and a stranger still can't.
//
// canWriteProject does a SELECT on projects, then (org-owned)
// organization_members or (personal) project_collaborators. The
// chainable mock ignores filters and returns whatever each table's
// stand-in is configured to hold for the test.

let projectsRow: {
  id: string;
  userId: string;
  organizationId: string | null;
  slug: string;
} | null = null;
let orgMembersRow: { id: string; role: string } | null = null;
let collabRow: { role: string } | null = null;

let deleteCalled = false;
let insertedRows: Array<Record<string, unknown>> | null = null;

function chainable<T>(arr: T[]) {
  return Object.assign(arr, { limit: () => arr });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "projects") {
            return chainable(projectsRow ? [projectsRow] : []);
          }
          if (table.__name === "organization_members") {
            return chainable(orgMembersRow ? [orgMembersRow] : []);
          }
          if (table.__name === "project_collaborators") {
            return chainable(collabRow ? [collabRow] : []);
          }
          return chainable([] as unknown[]);
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: () => ({
          where: () => {
            deleteCalled = true;
            return Promise.resolve();
          },
        }),
        insert: () => ({
          values: (vals: Array<Record<string, unknown>>) => {
            insertedRows = vals;
            return Promise.resolve();
          },
        }),
      };
      return cb(tx);
    },
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
  projectBomItems: {
    __name: "project_bom_items",
    projectId: "project_id",
  },
  organizationMembers: {
    __name: "organization_members",
    id: "id",
    organizationId: "organization_id",
    userId: "user_id",
    role: "role",
  },
  projectCollaborators: {
    __name: "project_collaborators",
    projectId: "project_id",
    userId: "user_id",
    role: "role",
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { replaceProjectBom } from "../bom";
import type { BomItemInput } from "@/lib/validations/bom";

// Annotated so the post-transform shape (where `unit` and `notes` are
// required string|undefined, not optional) is satisfied at the call
// site — caught after PR #21 merged when the merged tree was tsc'd.
const VALID_ITEMS: BomItemInput[] = [
  { name: "M3 bolt", quantity: 4, unit: "pcs", notes: undefined },
];

beforeEach(() => {
  vi.clearAllMocks();
  deleteCalled = false;
  insertedRows = null;
  orgMembersRow = null;
  collabRow = null;
  projectsRow = {
    id: "proj_1",
    userId: "test-user-id", // owner == authed viewer (vitest.setup.ts)
    organizationId: null,
    slug: "my-project-abc",
  };
});

describe("replaceProjectBom", () => {
  it("lets the project owner replace the BOM", async () => {
    const result = await replaceProjectBom("proj_1", VALID_ITEMS);
    expect((result as { ok?: boolean }).ok).toBe(true);
    expect(deleteCalled).toBe(true);
    expect(insertedRows?.[0]).toMatchObject({
      projectId: "proj_1",
      name: "M3 bolt",
      quantity: 4,
      sortOrder: 0,
    });
  });

  it("lets an org member edit an org-owned project's BOM (CON-83)", async () => {
    projectsRow = {
      id: "proj_1",
      userId: "someone_else",
      organizationId: "org_1",
      slug: "my-project-abc",
    };
    orgMembersRow = { id: "om_1", role: "member" };

    const result = await replaceProjectBom("proj_1", VALID_ITEMS);
    expect((result as { ok?: boolean }).ok).toBe(true);
    expect(insertedRows).not.toBeNull();
  });

  it("lets a per-project collaborator edit the BOM (CON-83)", async () => {
    projectsRow = {
      id: "proj_1",
      userId: "someone_else",
      organizationId: null,
      slug: "my-project-abc",
    };
    collabRow = { role: "editor" };

    const result = await replaceProjectBom("proj_1", VALID_ITEMS);
    expect((result as { ok?: boolean }).ok).toBe(true);
  });

  it("rejects a viewer with no write access", async () => {
    projectsRow = {
      id: "proj_1",
      userId: "someone_else",
      organizationId: null,
      slug: "my-project-abc",
    };

    const result = await replaceProjectBom("proj_1", VALID_ITEMS);
    expect((result as { error?: string }).error).toBe("Project not found");
    expect(deleteCalled).toBe(false);
    expect(insertedRows).toBeNull();
  });

  it("rejects when the project doesn't exist", async () => {
    projectsRow = null;
    const result = await replaceProjectBom("proj_1", VALID_ITEMS);
    expect((result as { error?: string }).error).toBe("Project not found");
  });
});
