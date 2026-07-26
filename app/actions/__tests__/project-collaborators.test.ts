import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test responses for each table the collaborator actions touch.
// `users` returns the target user being added; `project_collaborators`
// returns the existing rows for listing + tracks inserts/deletes.
//
// The canWriteProject check inside the auth helper does a follow-up
// SELECT on projects + (sometimes) organization_members and
// project_collaborators. Those are all routed through the same
// chainable `.where().limit()` shape.

let projectsRow: {
  id: string;
  userId: string;
  organizationId: string | null;
  name: string;
  slug: string;
  status?: string;
  visibility?: string;
} | null = null;
let userLookup: {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
} | null = null;
let orgMembersRow: { id: string; role: string } | null = null;
// Shape varies by caller: addProjectCollaborator's canWriteProject
// check reads {id, userId, role} rows; listProjectCollaborators'
// roster select reads the joined {id, username, displayName,
// avatarUrl, role, addedAt} shape. Both go through the same mock
// variable, so it's loosely typed here.
let collabRowsForProject: Array<Record<string, unknown>> = [];
const inserted: Array<Record<string, unknown>> = [];
const deletedFilters: Array<unknown> = [];
let insertConflictReturnEmpty = false;

function chainable<T>(arr: T[]) {
  return Object.assign(arr, { limit: () => arr });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => {
        const handler = {
          where: () => {
            if (table.__name === "projects") {
              return chainable(projectsRow ? [projectsRow] : []);
            }
            if (table.__name === "users") {
              return chainable(userLookup ? [userLookup] : []);
            }
            if (table.__name === "organization_members") {
              return chainable(orgMembersRow ? [orgMembersRow] : []);
            }
            if (table.__name === "project_collaborators") {
              return chainable(collabRowsForProject);
            }
            return chainable([] as unknown[]);
          },
          innerJoin: () => ({
            where: () => ({
              orderBy: () => collabRowsForProject,
              limit: () => chainable(collabRowsForProject),
            }),
          }),
          orderBy: () => collabRowsForProject,
        };
        return handler;
      },
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (insertConflictReturnEmpty) return [];
            inserted.push(vals);
            return [{ id: "pc_new" }];
          },
        }),
      }),
    }),
    delete: () => ({
      where: (filter: unknown) => {
        deletedFilters.push(filter);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {
    __name: "projects",
    id: "id",
    userId: "user_id",
    organizationId: "organization_id",
    slug: "slug",
    name: "name",
  },
  projectFiles: { __name: "project_files" },
  projectPhotos: { __name: "project_photos" },
  purchases: { __name: "purchases" },
  users: {
    __name: "users",
    id: "id",
    username: "username",
    displayName: "display_name",
    avatarUrl: "avatar_url",
  },
  files: { __name: "files" },
  organizationMembers: {
    __name: "organization_members",
    id: "id",
    organizationId: "organization_id",
    userId: "user_id",
    role: "role",
  },
  projectCollaborators: {
    __name: "project_collaborators",
    id: "id",
    projectId: "project_id",
    userId: "user_id",
    role: "role",
    createdAt: "created_at",
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

const notifyMock = vi.fn();
vi.mock("@/lib/notifications/notify", () => ({
  notifyCollaboratorAddedToProject: (...args: unknown[]) => {
    notifyMock(...args);
    return Promise.resolve();
  },
}));

import {
  addProjectCollaborator,
  listProjectCollaborators,
  removeProjectCollaborator,
} from "../projects";
import { setMockUserId } from "@/vitest.setup";

beforeEach(() => {
  vi.clearAllMocks();
  setMockUserId("test-user-id");
  inserted.length = 0;
  deletedFilters.length = 0;
  collabRowsForProject = [];
  orgMembersRow = null;
  insertConflictReturnEmpty = false;
  // Published + public by default so the pre-existing addProjectCollaborator
  // / removeProjectCollaborator suites (which never set status/visibility)
  // keep exercising the owner-only write path unaffected by the new
  // listProjectCollaborators visibility gate below.
  projectsRow = {
    id: "proj_1",
    userId: "test-user-id",
    organizationId: null,
    name: "My Project",
    slug: "my-project-abc",
    status: "published",
    visibility: "public",
  };
  userLookup = {
    id: "user_invitee",
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
  };
});

describe("addProjectCollaborator", () => {
  it("inserts a collaborator + fires a notification when the owner invites", async () => {
    const result = await addProjectCollaborator("proj_1", "alice");
    expect((result as { success?: boolean }).success).toBe(true);
    expect(inserted[0]).toMatchObject({
      projectId: "proj_1",
      userId: "user_invitee",
      addedBy: "test-user-id",
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("strips a leading @ from the username input", async () => {
    const result = await addProjectCollaborator("proj_1", "@alice");
    expect((result as { success?: boolean }).success).toBe(true);
  });

  it("rejects when the viewer is only a collaborator (not owner / org)", async () => {
    // Hand the project to someone else; the viewer is a collaborator
    // on it (per the canWriteProject collaborator branch) — so the
    // base ownership check fails, then collaborator picks it up.
    // addProjectCollaborator must reject because viaCollaborator
    // does NOT confer the right to invite more people.
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
    };
    collabRowsForProject = [
      // viewer is a collab; the canWriteProject path queries
      // project_collaborators with the (userId, projectId) filter,
      // which our mock returns regardless of the filter — fine for
      // this single-row test.
      { id: "pc_1", userId: "test-user-id", role: "editor" },
    ];

    const result = await addProjectCollaborator("proj_1", "alice");
    expect((result as { error?: string }).error).toBe(
      "You don't have permission to add collaborators."
    );
    expect(inserted.length).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("returns a clear error when the target username isn't a user", async () => {
    userLookup = null;
    const result = await addProjectCollaborator("proj_1", "ghost");
    expect((result as { error?: string }).error).toMatch(/No user found/);
    expect(inserted.length).toBe(0);
  });

  it("rejects adding the project owner as their own collaborator", async () => {
    userLookup = {
      id: "test-user-id", // same id as the owner via vitest.setup.ts
      username: "owner-handle",
      displayName: null,
      avatarUrl: null,
    };
    const result = await addProjectCollaborator("proj_1", "owner-handle");
    expect((result as { error?: string }).error).toBe(
      "That user is the project owner."
    );
    expect(inserted.length).toBe(0);
  });

  it("returns 'already a collaborator' on duplicate (onConflictDoNothing returns empty)", async () => {
    insertConflictReturnEmpty = true;
    const result = await addProjectCollaborator("proj_1", "alice");
    expect((result as { error?: string }).error).toBe(
      "Already a collaborator."
    );
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("listProjectCollaborators (MTR-234)", () => {
  const roster = [
    {
      id: "user_invitee",
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
      role: "editor",
      addedAt: new Date("2026-01-01"),
    },
  ];

  it("returns the roster for a public published project, even anonymously", async () => {
    setMockUserId(null);
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
      status: "published",
      visibility: "public",
    };
    collabRowsForProject = roster;

    const result = await listProjectCollaborators("proj_1");
    expect(result).toEqual(roster);
  });

  it("returns [] for a private project when the viewer is anonymous", async () => {
    setMockUserId(null);
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
      status: "draft",
      visibility: "private",
    };
    collabRowsForProject = roster;

    const result = await listProjectCollaborators("proj_1");
    expect(result).toEqual([]);
  });

  it("returns the roster for a private project when the viewer is the owner", async () => {
    setMockUserId("test-user-id");
    projectsRow = {
      id: "proj_1",
      userId: "test-user-id",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
      status: "draft",
      visibility: "private",
    };
    collabRowsForProject = roster;

    const result = await listProjectCollaborators("proj_1");
    expect(result).toEqual(roster);
  });

  it("returns the roster for a private project when the viewer is a collaborator", async () => {
    setMockUserId("test-user-id");
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
      status: "draft",
      visibility: "private",
    };
    // canWriteProject's base ownership check fails (viewer isn't the
    // owner / an org member), so it falls through to the collaborator
    // check — which the mock also serves from collabRowsForProject.
    collabRowsForProject = [{ id: "pc_1", userId: "test-user-id", role: "editor" }];

    const result = await listProjectCollaborators("proj_1");
    expect(result).toEqual(collabRowsForProject);
  });

  it("returns [] for a private project when the viewer has no access", async () => {
    setMockUserId("stranger");
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
      status: "draft",
      visibility: "private",
    };
    // Empty (not `roster`) so isProjectCollaborator's follow-up query
    // — which the mock serves from this same variable regardless of
    // the queried userId — also correctly denies "stranger".
    collabRowsForProject = [];

    const result = await listProjectCollaborators("proj_1");
    expect(result).toEqual([]);
  });
});

describe("removeProjectCollaborator", () => {
  it("lets the owner remove anyone", async () => {
    const result = await removeProjectCollaborator("proj_1", "user_invitee");
    expect((result as { success?: boolean }).success).toBe(true);
    expect(deletedFilters.length).toBe(1);
  });

  it("lets a collaborator remove themselves but not others", async () => {
    // Viewer is a collaborator; project owner is someone else.
    projectsRow = {
      id: "proj_1",
      userId: "user_owner",
      organizationId: null,
      name: "My Project",
      slug: "my-project-abc",
    };
    collabRowsForProject = [
      { id: "pc_1", userId: "test-user-id", role: "editor" },
    ];

    const ownAttempt = await removeProjectCollaborator(
      "proj_1",
      "test-user-id"
    );
    expect((ownAttempt as { success?: boolean }).success).toBe(true);

    const otherAttempt = await removeProjectCollaborator(
      "proj_1",
      "someone_else"
    );
    expect((otherAttempt as { error?: string }).error).toBe(
      "Collaborators can only remove themselves."
    );
  });
});
