/**
 * Focused test for the access decision in
 * GET /api/thumbnails/projects/[projectId] (MTR-136).
 *
 * Before the fix this route gated draft/private project covers on
 * `userId === project.userId` only, so an org co-owner who can edit
 * the project via the write-side APIs still got a placeholder image
 * for it. The fix swaps that comparison for `canWriteProject`, which
 * covers owner + org member + per-project collaborator (mirrors
 * /api/circuits/[circuitId]/source/route.ts).
 *
 * This test stubs `canWriteProject` directly rather than re-deriving
 * org/collaborator membership through the DB — that decision logic
 * already has its own coverage in lib/__tests__/authorization.test.ts
 * and app/actions/__tests__/bom.test.ts. Here we only need to pin
 * that the route calls the shared helper and honors its verdict.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let projectRow: Record<string, unknown> | null = null;

// A `where()` result that can be awaited directly (the plain project /
// single-photo-by-id lookups) AND further chained with
// `.orderBy().limit()` (the "auto" first-curator-photo fallback query).
// Both call sites just need `[]` back for this test — we're not
// exercising photo resolution, only the access decision upstream of it.
function chainableRows<T>(arr: T[]) {
  const obj = {
    then: (resolve: (v: T[]) => void) => resolve(arr),
    orderBy: () => obj,
    limit: () => obj,
  };
  return obj;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "projects") {
            return chainableRows(projectRow ? [projectRow] : []);
          }
          // projectPhotos lookups (cover / ?photoId / auto-fallback) —
          // not under test here.
          return chainableRows([] as unknown[]);
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projects: {
    __name: "projects",
    id: "id",
    thumbnailUrl: "thumbnailUrl",
    status: "status",
    visibility: "visibility",
    userId: "userId",
    coverPhotoId: "coverPhotoId",
  },
  projectPhotos: {
    __name: "project_photos",
    id: "id",
    storageKey: "storageKey",
    projectId: "projectId",
    kind: "kind",
    sortOrder: "sortOrder",
  },
}));

const mockCanWriteProject = vi.fn();
vi.mock("@/lib/authorization", () => ({
  canWriteProject: (...args: unknown[]) => mockCanWriteProject(...args),
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed-url"),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { GET } from "../route";
import { setMockUserId } from "@/vitest.setup";

const PROJECT_ID = "ba14f9ed-106b-46e3-8abc-123456789012";

function makeRequest(projectId: string) {
  const req = new Request(`http://localhost/api/thumbnails/projects/${projectId}`);
  const context = { params: Promise.resolve({ projectId }) };
  return { req, context };
}

function draftProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    thumbnailUrl: "projects/legacy-cover.webp",
    status: "draft",
    visibility: "private",
    userId: "owner-1",
    coverPhotoId: null,
    ...overrides,
  };
}

describe("GET /api/thumbnails/projects/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRow = null;
    mockCanWriteProject.mockResolvedValue({ ok: false, reason: "forbidden" });
  });

  it("serves a placeholder for a draft/private project when canWriteProject says no", async () => {
    setMockUserId("stranger");
    projectRow = draftProject();
    mockCanWriteProject.mockResolvedValue({ ok: false, reason: "forbidden" });

    const { req, context } = makeRequest(PROJECT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png"); // placeholder
    expect(mockCanWriteProject).toHaveBeenCalledWith("stranger", PROJECT_ID);
  });

  it("streams the real cover for a draft/private project when canWriteProject grants access via org/collaborator (MTR-136)", async () => {
    setMockUserId("org-teammate");
    projectRow = draftProject();
    // The uploader is "owner-1"; this viewer only passes via the org/
    // collaborator branch of canWriteProject, not raw ownership — the
    // exact gap MTR-136 fixes.
    mockCanWriteProject.mockResolvedValue({ ok: true, viaOrg: true });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("FAKE_WEBP_BYTES", {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    );

    const { req, context } = makeRequest(PROJECT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(mockCanWriteProject).toHaveBeenCalledWith("org-teammate", PROJECT_ID);

    fetchSpy.mockRestore();
  });

  it("skips the canWriteProject check entirely for a published + public project", async () => {
    setMockUserId(null);
    projectRow = draftProject({ status: "published", visibility: "public" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("FAKE_WEBP_BYTES", {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    );

    const { req, context } = makeRequest(PROJECT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(mockCanWriteProject).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
