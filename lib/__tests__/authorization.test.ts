import { describe, it, expect, vi, beforeEach } from "vitest";

// Drizzle-shaped mock: each table's row set lives in its own
// per-test-controlled list; the select chain looks up the right one
// off the schema's `__name` tag. Matches the pattern in
// app/actions/__tests__/projects.test.ts so the mock stays familiar.

let filesRows: Array<{
  id: string;
  userId: string;
  organizationId: string | null;
}> = [];
let projectsRows: Array<{
  id: string;
  userId: string;
  organizationId: string | null;
}> = [];
let collectionsRows: Array<{
  id: string;
  userId: string;
  organizationId: string | null;
}> = [];
let orgMembersRows: Array<{
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}> = [];
let orgsRows: Array<{ id: string; slug: string; name: string; imageUrl: string | null }> = [];

function chainable<T>(arr: T[]) {
  return Object.assign(arr, { limit: () => arr });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        const handler = {
          where: () => {
            if (table.__name === "files") return chainable(filesRows);
            if (table.__name === "projects") return chainable(projectsRows);
            if (table.__name === "collections") return chainable(collectionsRows);
            if (table.__name === "organization_members")
              return chainable(orgMembersRows);
            if (table.__name === "organizations") return chainable(orgsRows);
            return chainable([] as unknown[]);
          },
          innerJoin: () => handler,
        };
        return handler;
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: {
    __name: "files",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
  },
  projects: {
    __name: "projects",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
  },
  collections: {
    __name: "collections",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
  },
  printOrders: {
    __name: "print_orders",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
  },
  organizationMembers: {
    __name: "organization_members",
    id: "id",
    organizationId: "organization_id",
    userId: "user_id",
    role: "role",
  },
  organizations: { __name: "organizations", id: "id", slug: "slug" },
}));

import {
  canWriteFile,
  canWriteProject,
  isOrgMember,
  resolveOwnerForCreate,
  viewerCanAttachAllFiles,
} from "../authorization";

beforeEach(() => {
  filesRows = [];
  projectsRows = [];
  collectionsRows = [];
  orgMembersRows = [];
  orgsRows = [];
});

describe("isOrgMember", () => {
  it("returns false for anonymous viewers without a DB hit", async () => {
    const result = await isOrgMember(null, "org_abc");
    expect(result).toEqual({ member: false, role: null });
  });

  it("returns false when the membership row is missing", async () => {
    orgMembersRows = [];
    const result = await isOrgMember("user_1", "org_abc");
    expect(result.member).toBe(false);
  });

  it("returns true with role when membership exists", async () => {
    orgMembersRows = [
      { id: "mem_1", organizationId: "org_abc", userId: "user_1", role: "admin" },
    ];
    const result = await isOrgMember("user_1", "org_abc");
    expect(result).toEqual({ member: true, role: "admin" });
  });
});

describe("canWriteFile", () => {
  it("rejects anonymous callers without consulting the row", async () => {
    const result = await canWriteFile(null, "file_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthenticated");
  });

  it("returns not-found when the file is missing", async () => {
    filesRows = [];
    const result = await canWriteFile("user_1", "file_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  });

  it("allows the personal owner", async () => {
    filesRows = [{ id: "file_1", userId: "user_1", organizationId: null }];
    const result = await canWriteFile("user_1", "file_1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viaOrg).toBe(false);
  });

  it("rejects a stranger on a personal file", async () => {
    filesRows = [{ id: "file_1", userId: "user_owner", organizationId: null }];
    const result = await canWriteFile("user_stranger", "file_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });

  it("allows any member of the owning org", async () => {
    filesRows = [
      { id: "file_1", userId: "user_uploader", organizationId: "org_abc" },
    ];
    orgMembersRows = [
      {
        id: "mem_1",
        organizationId: "org_abc",
        userId: "user_teammate",
        role: "member",
      },
    ];
    const result = await canWriteFile("user_teammate", "file_1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viaOrg).toBe(true);
  });

  it("rejects non-members on an org-owned file", async () => {
    filesRows = [
      { id: "file_1", userId: "user_uploader", organizationId: "org_abc" },
    ];
    orgMembersRows = [];
    const result = await canWriteFile("user_stranger", "file_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });
});

describe("canWriteProject", () => {
  it("allows org members even when they didn't create the project", async () => {
    projectsRows = [
      { id: "proj_1", userId: "user_other", organizationId: "org_abc" },
    ];
    orgMembersRows = [
      {
        id: "mem_1",
        organizationId: "org_abc",
        userId: "user_teammate",
        role: "member",
      },
    ];
    const result = await canWriteProject("user_teammate", "proj_1");
    expect(result.ok).toBe(true);
  });
});

describe("resolveOwnerForCreate", () => {
  it("returns personal (null) when no org is requested", async () => {
    const result = await resolveOwnerForCreate("user_1", null);
    expect(result).toEqual({ ok: true, organizationId: null });
  });

  it("returns the org id when the viewer is a member", async () => {
    orgMembersRows = [
      { id: "mem_1", organizationId: "org_abc", userId: "user_1", role: "member" },
    ];
    const result = await resolveOwnerForCreate("user_1", "org_abc");
    expect(result).toEqual({ ok: true, organizationId: "org_abc" });
  });

  it("rejects when the viewer claims membership they don't have", async () => {
    orgMembersRows = [];
    const result = await resolveOwnerForCreate("user_1", "org_attacker");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("treats empty string the same as null (personal)", async () => {
    const result = await resolveOwnerForCreate("user_1", "");
    expect(result).toEqual({ ok: true, organizationId: null });
  });
});

describe("viewerCanAttachAllFiles", () => {
  it("returns false on empty input — the caller is creating a project that bundles nothing", async () => {
    const result = await viewerCanAttachAllFiles("user_1", []);
    expect(result).toBe(false);
  });

  it("accepts files owned personally by the viewer", async () => {
    filesRows = [
      { id: "f1", userId: "user_1", organizationId: null },
      { id: "f2", userId: "user_1", organizationId: null },
    ];
    const result = await viewerCanAttachAllFiles("user_1", ["f1", "f2"]);
    expect(result).toBe(true);
  });

  it("accepts files owned by orgs the viewer belongs to", async () => {
    filesRows = [
      { id: "f1", userId: "user_someone_else", organizationId: "org_abc" },
      { id: "f2", userId: "user_1", organizationId: null },
    ];
    orgMembersRows = [
      { id: "mem_1", organizationId: "org_abc", userId: "user_1", role: "member" },
    ];
    const result = await viewerCanAttachAllFiles("user_1", ["f1", "f2"]);
    expect(result).toBe(true);
  });

  it("rejects when any file is outside the viewer's reach", async () => {
    filesRows = [
      { id: "f1", userId: "user_1", organizationId: null },
      { id: "f2", userId: "user_other", organizationId: "org_other" },
    ];
    orgMembersRows = [];
    const result = await viewerCanAttachAllFiles("user_1", ["f1", "f2"]);
    expect(result).toBe(false);
  });

  it("rejects when one of the requested ids does not exist", async () => {
    filesRows = [{ id: "f1", userId: "user_1", organizationId: null }];
    const result = await viewerCanAttachAllFiles("user_1", ["f1", "f2-missing"]);
    expect(result).toBe(false);
  });
});
