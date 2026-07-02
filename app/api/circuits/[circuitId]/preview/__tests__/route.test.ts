/**
 * Focused test for the access decision in
 * GET /api/circuits/[circuitId]/preview (MTR-136).
 *
 * Before the fix this route gated draft/private circuit previews on
 * `userId === row.projectUserId` only, so an org co-owner or
 * per-project collaborator who can edit the project (and its circuit
 * source, via /api/circuits/[circuitId]/source/route.ts's
 * canWriteProject check) still got a 404 for the preview image. The
 * fix swaps that comparison for `canWriteProject` to match the
 * sibling source route.
 *
 * `canWriteProject` is stubbed directly — its own org/collaborator
 * derivation already has coverage in lib/__tests__/authorization.test.ts
 * and app/actions/__tests__/bom.test.ts. Here we only pin that this
 * route calls the shared helper and honors its verdict.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let circuitRow: Record<string, unknown> | null = null;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(circuitRow ? [circuitRow] : []),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  projectCircuits: {
    id: "id",
    projectId: "projectId",
    previewStorageKey: "previewStorageKey",
  },
  projects: {
    id: "id",
    status: "status",
    visibility: "visibility",
    userId: "userId",
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

const CIRCUIT_ID = "ba14f9ed-106b-46e3-8abc-123456789012";
const PROJECT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeRequest(circuitId: string) {
  const req = new Request(`http://localhost/api/circuits/${circuitId}/preview`);
  const context = { params: Promise.resolve({ circuitId }) };
  return { req, context };
}

function draftRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    previewStorageKey: "circuits/preview.png",
    projectId: PROJECT_ID,
    projectStatus: "draft",
    projectVisibility: "private",
    projectUserId: "owner-1",
    ...overrides,
  };
}

describe("GET /api/circuits/[circuitId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circuitRow = null;
    mockCanWriteProject.mockResolvedValue({ ok: false, reason: "forbidden" });
  });

  it("404s a draft/private circuit's preview when canWriteProject says no", async () => {
    setMockUserId("stranger");
    circuitRow = draftRow();
    mockCanWriteProject.mockResolvedValue({ ok: false, reason: "forbidden" });

    const { req, context } = makeRequest(CIRCUIT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(404);
    expect(mockCanWriteProject).toHaveBeenCalledWith("stranger", PROJECT_ID);
  });

  it("302s to the signed preview URL when canWriteProject grants access via org/collaborator (MTR-136)", async () => {
    setMockUserId("org-teammate");
    circuitRow = draftRow();
    // The project owner is "owner-1"; this viewer only passes via the
    // org/collaborator branch of canWriteProject — the exact gap
    // MTR-136 fixes for this route.
    mockCanWriteProject.mockResolvedValue({ ok: true, viaOrg: true });

    const { req, context } = makeRequest(CIRCUIT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://r2.example.com/signed-url");
    expect(mockCanWriteProject).toHaveBeenCalledWith("org-teammate", PROJECT_ID);
  });

  it("skips the canWriteProject check entirely for a published + public project", async () => {
    setMockUserId(null);
    circuitRow = draftRow({ projectStatus: "published", projectVisibility: "public" });

    const { req, context } = makeRequest(CIRCUIT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(302);
    expect(mockCanWriteProject).not.toHaveBeenCalled();
  });

  it("404s when the circuit row (or its preview) doesn't exist", async () => {
    setMockUserId("anyone");
    circuitRow = null;

    const { req, context } = makeRequest(CIRCUIT_ID);
    const res = await GET(req, context);

    expect(res.status).toBe(404);
    expect(mockCanWriteProject).not.toHaveBeenCalled();
  });
});
