/**
 * Tests for GET /api/files/preview/[fileAssetId] (CON-145, MTR-136).
 *
 * Behavior matrix (verified against route.ts):
 *   - published file → anyone including anon → 200 (streams bytes)
 *   - draft file + anon → 403
 *   - draft file + owner → 200
 *   - draft file + other user → 403
 *   - draft file + org co-owner (isOrgMember) → 200 (MTR-136)
 *   - draft file + non-member of the owning org → 403 (MTR-136)
 *   - missing row → 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;
let assetRow: Record<string, unknown> | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  fileAssets: {
    id: "id",
    fileId: "fileId",
    storageKey: "storageKey",
    format: "format",
  },
  files: {
    id: "id",
    price: "price",
    userId: "userId",
    organizationId: "organizationId",
    status: "status",
  },
}));

// isOrgMember is exercised as its own unit in lib/__tests__/authorization.test.ts;
// here we only need to pin that the route calls it and honors the result.
const mockIsOrgMember = vi.fn();
vi.mock("@/lib/authorization", () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(assetRow ? [assetRow] : []),
        }),
      }),
    }),
  },
}));

// Do NOT use a top-level const in the factory (it gets hoisted).
// Instead, return a fixed string inline.
vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed"),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// after() runs its callback post-response in prod; run it inline so the
// promotion call is observable synchronously in tests.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
}));

const mockPromote = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/studio-drafts", () => ({
  promoteStudioDraftsForAssets: (...args: unknown[]) => mockPromote(...args),
}));

// Entitlement is unit-tested in lib/__tests__; the route only has to ask
// it (for paid, non-owner viewers) and honor the answer.
const mockOwnsLoadedFile = vi.fn();
vi.mock("@/lib/entitlement", () => ({
  ownsLoadedFile: (...args: unknown[]) => mockOwnsLoadedFile(...args),
}));

// Keep the real needsLowDetailPreview / key version; stub the R2-backed
// generator so the test sees exactly which variant was served.
const mockGetPreviewBytes = vi.fn();
vi.mock("@/lib/files/model-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files/model-preview")>()),
  getPreviewBytes: (...args: unknown[]) => mockGetPreviewBytes(...args),
}));

// Mock global fetch for the upstream R2 proxy
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GET } from "../route";

function makeRequest(url = "http://localhost/api/files/preview/asset-1") {
  return new Request(url);
}

function makeProps(fileAssetId: string) {
  return {
    params: Promise.resolve({ fileAssetId }),
  };
}

function asset(
  overrides: Partial<{
    storageKey: string;
    format: string;
    fileId: string | null;
    filePrice: number | null;
    fileUserId: string | null;
    fileOrganizationId: string | null;
    fileStatus: string;
    fileVisibility: string;
  }> = {}
) {
  return {
    storageKey: "uploads/owner-1/abc/model.stl",
    format: "stl",
    fileId: "file-1",
    filePrice: 0,
    fileUserId: "owner-1",
    fileOrganizationId: null,
    fileStatus: "published",
    fileVisibility: "public",
    ...overrides,
  };
}

function upstreamOk() {
  const body = new ReadableStream();
  mockFetch.mockResolvedValue(
    new Response(body, {
      status: 200,
      headers: { "content-length": "1024" },
    })
  );
}

beforeEach(() => {
  mockUserId = null;
  assetRow = null;
  mockFetch.mockReset();
  mockIsOrgMember.mockReset();
  mockIsOrgMember.mockResolvedValue({ member: false, role: null });
  mockPromote.mockClear();
  mockOwnsLoadedFile.mockReset();
  mockOwnsLoadedFile.mockResolvedValue(false);
  mockGetPreviewBytes.mockReset();
  mockGetPreviewBytes.mockResolvedValue(new Uint8Array([7, 7, 7]));
});

describe("preview/[fileAssetId] GET", () => {
  it("published file: anon gets 200", async () => {
    mockUserId = null;
    assetRow = asset({ fileStatus: "published" });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
  });

  it("published file: non-owner authenticated user gets 200", async () => {
    mockUserId = "other-user";
    assetRow = asset({ fileStatus: "published", fileUserId: "owner-1" });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
  });

  it("published but PRIVATE file: anon gets 403", async () => {
    mockUserId = null;
    assetRow = asset({ fileStatus: "published", fileVisibility: "private" });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("published but PRIVATE file: other authenticated user gets 403", async () => {
    mockUserId = "other-user";
    assetRow = asset({
      fileStatus: "published",
      fileVisibility: "private",
      fileUserId: "owner-1",
    });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
  });

  it("published but PRIVATE file: owner still gets 200", async () => {
    mockUserId = "owner-1";
    assetRow = asset({
      fileStatus: "published",
      fileVisibility: "private",
      fileUserId: "owner-1",
    });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
  });

  it("draft file: anon gets 403", async () => {
    mockUserId = null;
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
    // Should not have tried to hit R2
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("draft file: owner gets 200", async () => {
    mockUserId = "owner-1";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
  });

  it("draft file: other authenticated user gets 403", async () => {
    mockUserId = "other-user";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("draft file: org co-owner (not the uploader) gets 200 via isOrgMember (MTR-136)", async () => {
    mockUserId = "org-teammate";
    assetRow = asset({
      fileStatus: "draft",
      fileUserId: "owner-1",
      fileOrganizationId: "org-1",
    });
    mockIsOrgMember.mockResolvedValue({ member: true, role: "member" });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockIsOrgMember).toHaveBeenCalledWith("org-teammate", "org-1");
  });

  it("draft file: authenticated non-member of the owning org still gets 403 (MTR-136)", async () => {
    mockUserId = "stranger";
    assetRow = asset({
      fileStatus: "draft",
      fileUserId: "owner-1",
      fileOrganizationId: "org-1",
    });
    mockIsOrgMember.mockResolvedValue({ member: false, role: null });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("?download=1 by the owner promotes the studio draft (a download is a save)", async () => {
    mockUserId = "owner-1";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });
    upstreamOk();

    const res = await GET(
      makeRequest("http://localhost/api/files/preview/asset-1?download=1"),
      makeProps("asset-1")
    );
    expect(res.status).toBe(200);
    expect(mockPromote).toHaveBeenCalledWith({
      userId: "owner-1",
      fileAssetIds: ["asset-1"],
    });
  });

  it("?download=1 by a non-owner never promotes", async () => {
    mockUserId = "other-user";
    assetRow = asset({ fileStatus: "published", fileUserId: "owner-1" });
    upstreamOk();

    const res = await GET(
      makeRequest("http://localhost/api/files/preview/asset-1?download=1"),
      makeProps("asset-1")
    );
    expect(res.status).toBe(200);
    expect(mockPromote).not.toHaveBeenCalled();
  });

  it("a plain viewer fetch (no download flag) never promotes", async () => {
    mockUserId = "owner-1";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockPromote).not.toHaveBeenCalled();
  });

  it("missing row gets 404", async () => {
    mockUserId = null;
    assetRow = null;

    const res = await GET(makeRequest(), makeProps("nonexistent"));
    expect(res.status).toBe(404);
  });
});

describe("preview/[fileAssetId] GET — paid listings", () => {
  it("free listing: no entitlement query, original bytes, long immutable cache", async () => {
    mockUserId = "other-user";
    assetRow = asset({ filePrice: 0 });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockOwnsLoadedFile).not.toHaveBeenCalled();
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=86400, immutable"
    );
  });

  it("paid listing, anon: low-detail copy, never the original", async () => {
    mockUserId = null;
    assetRow = asset({ filePrice: 500 });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetPreviewBytes).toHaveBeenCalledWith({
      id: "asset-1",
      storageKey: "uploads/owner-1/abc/model.stl",
      format: "stl",
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([7, 7, 7])
    );
    expect(res.headers.get("Content-Type")).toBe("model/stl");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("ETag")).toBe('"asset-1.preview.v1"');
  });

  it("paid listing, signed-in non-buyer: entitlement checked, low-detail copy", async () => {
    mockUserId = "other-user";
    assetRow = asset({ filePrice: 500, fileOrganizationId: "org-1" });

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockOwnsLoadedFile).toHaveBeenCalledWith("other-user", {
      id: "file-1",
      price: 500,
      userId: "owner-1",
      organizationId: "org-1",
    });
    expect(mockGetPreviewBytes).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("paid listing, buyer: full original, revalidating cache with the full ETag", async () => {
    mockUserId = "buyer";
    assetRow = asset({ filePrice: 500 });
    mockOwnsLoadedFile.mockResolvedValue(true);
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("ETag")).toBe('"asset-1.full"');
  });

  it("paid listing, owner: full original without an entitlement query", async () => {
    mockUserId = "owner-1";
    assetRow = asset({ filePrice: 500 });
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(200);
    expect(mockOwnsLoadedFile).not.toHaveBeenCalled();
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
  });

  it("a cached low-detail copy is NOT revalidated once the viewer has bought the file", async () => {
    mockUserId = "buyer";
    assetRow = asset({ filePrice: 500 });
    mockOwnsLoadedFile.mockResolvedValue(true);
    upstreamOk();

    const res = await GET(
      new Request("http://localhost/api/files/preview/asset-1", {
        headers: { "If-None-Match": '"asset-1.preview.v1"' },
      }),
      makeProps("asset-1")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"asset-1.full"');
  });

  it("a matching ETag gets a 304 without touching R2", async () => {
    mockUserId = null;
    assetRow = asset({ filePrice: 500 });

    const res = await GET(
      new Request("http://localhost/api/files/preview/asset-1", {
        headers: { "If-None-Match": '"asset-1.preview.v1"' },
      }),
      makeProps("asset-1")
    );
    expect(res.status).toBe(304);
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("paid STEP/AMF with no low-detail copy: 403, never the original", async () => {
    mockUserId = null;
    assetRow = asset({ filePrice: 500, format: "step" });
    mockGetPreviewBytes.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeProps("asset-1"));
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
