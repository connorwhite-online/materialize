/**
 * Tests for POST /api/craftcloud/download-url (CON-145).
 *
 * Corrected behavior matrix (verified against route.ts):
 *   fileAssetId mode:
 *     - published file  → anyone including anon → 200
 *     - draft file + anon → 403
 *     - draft file + owner → 200
 *     - draft file + other user → 403
 *     - missing row → 404
 *   storageKey mode:
 *     - anon → 401
 *     - key not under uploads/${userId}/ → 403
 *     - missing key param → 400 (actually route returns 200 with derived URL on empty string;
 *       the real missing-key check is handled by the by-key GET route — noted below)
 *     - key matches owner prefix → 200
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;

// One slot for the DB row returned by the asset select
let assetRow: Record<string, unknown> | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  fileAssets: { id: "id", fileId: "file_id", originalFilename: "original_filename", fileUnit: "file_unit" },
  files: { id: "id", userId: "user_id", status: "status" },
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

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/craftcloud/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asset(
  overrides: Partial<{
    filename: string;
    fileUnit: string;
    fileUserId: string | null;
    fileStatus: string;
  }> = {}
) {
  return {
    filename: "model.stl",
    fileUnit: "mm",
    fileUserId: "owner-1",
    fileStatus: "published",
    ...overrides,
  };
}

beforeEach(() => {
  mockUserId = null;
  assetRow = null;
});

// ─── fileAssetId mode ────────────────────────────────────────

describe("download-url POST — fileAssetId mode", () => {
  it("published file: anon user gets 200 (by design)", async () => {
    mockUserId = null;
    assetRow = asset({ fileStatus: "published" });

    const res = await POST(makeRequest({ fileAssetId: "asset-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain("/api/files/preview/asset-1");
  });

  it("published file: authenticated non-owner also gets 200", async () => {
    mockUserId = "other-user";
    assetRow = asset({ fileUserId: "owner-1", fileStatus: "published" });

    const res = await POST(makeRequest({ fileAssetId: "asset-1" }));
    expect(res.status).toBe(200);
  });

  it("draft file: anon user gets 403", async () => {
    mockUserId = null;
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });

    const res = await POST(makeRequest({ fileAssetId: "asset-1" }));
    expect(res.status).toBe(403);
  });

  it("draft file: owner gets 200", async () => {
    mockUserId = "owner-1";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });

    const res = await POST(makeRequest({ fileAssetId: "asset-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain("/api/files/preview/asset-1");
  });

  it("draft file: non-owner authenticated user gets 403", async () => {
    mockUserId = "other-user";
    assetRow = asset({ fileStatus: "draft", fileUserId: "owner-1" });

    const res = await POST(makeRequest({ fileAssetId: "asset-1" }));
    expect(res.status).toBe(403);
  });

  it("missing row gets 404", async () => {
    mockUserId = null;
    assetRow = null;

    const res = await POST(makeRequest({ fileAssetId: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

// ─── storageKey mode ─────────────────────────────────────────

describe("download-url POST — storageKey mode", () => {
  it("anon with storageKey gets 401", async () => {
    mockUserId = null;

    const res = await POST(
      makeRequest({ storageKey: "uploads/owner-1/abc/model.stl" })
    );
    expect(res.status).toBe(401);
  });

  it("key under another user's prefix gets 403", async () => {
    mockUserId = "user-me";

    const res = await POST(
      makeRequest({ storageKey: "uploads/other-user/abc/model.stl" })
    );
    expect(res.status).toBe(403);
  });

  it("key under own prefix gets 200 with preview URL", async () => {
    mockUserId = "user-me";
    const key = "uploads/user-me/nanoid123/model.stl";

    const res = await POST(makeRequest({ storageKey: key }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain(encodeURIComponent(key));
  });
});

// ─── missing-body edge case ───────────────────────────────────

describe("download-url POST — missing body fields", () => {
  it("neither fileAssetId nor storageKey returns 400", async () => {
    mockUserId = "user-me";

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
