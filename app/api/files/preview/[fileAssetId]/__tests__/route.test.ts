/**
 * Tests for GET /api/files/preview/[fileAssetId] (CON-145).
 *
 * Behavior matrix (verified against route.ts):
 *   - published file → anyone including anon → 200 (streams bytes)
 *   - draft file + anon → 403
 *   - draft file + owner → 200
 *   - draft file + other user → 403
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
  files: { id: "id", userId: "userId", status: "status" },
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
    fileUserId: string | null;
    fileStatus: string;
  }> = {}
) {
  return {
    storageKey: "uploads/owner-1/abc/model.stl",
    format: "stl",
    fileUserId: "owner-1",
    fileStatus: "published",
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

  it("missing row gets 404", async () => {
    mockUserId = null;
    assetRow = null;

    const res = await GET(makeRequest(), makeProps("nonexistent"));
    expect(res.status).toBe(404);
  });
});
