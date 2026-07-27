/**
 * Tests for GET /(app)/files/[slug]/download (TEST-22, 2026-07-25 audit).
 *
 * This route is the single enforcement point for paid-content access. Two
 * gates run in a specific order before any bytes are served:
 *   1. status !== "published" -> 404 for anyone but the owner/org member
 *      (this runs FIRST and must not be bypassable by the price===0
 *      early-return inside ownsLoadedFile/entitlement)
 *   2. ownsLoadedFile(userId, file) -> 401 (anon) / 402 (signed-in, unpaid)
 *
 * Behavior matrix asserted here:
 *   - anon + paid published file -> 401
 *   - signed-in non-owner + paid published file -> 402
 *   - owner (creator) -> 200
 *   - unpublished (draft) file, price===0, non-owner -> 404, NOT 200
 *     (proves the draft gate runs before the entitlement check, which would
 *     otherwise treat any price-0 file as world-downloadable)
 *   - downloadCount increment + fileDownloads insert happen ONLY on the
 *     200 path, never on 401/402/404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;
let fileRow: Record<string, unknown> | null = null;
let assetRow: Record<string, unknown> | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  files: {
    __name: "files",
    id: "id",
    slug: "slug",
    userId: "userId",
    organizationId: "organizationId",
    price: "price",
    status: "status",
    downloadCount: "downloadCount",
  },
  fileAssets: {
    __name: "file_assets",
    id: "id",
    fileId: "fileId",
  },
  fileDownloads: { __name: "file_downloads" },
  purchases: { __name: "purchases" },
  projectFiles: { __name: "project_files" },
}));

const updateSpy = vi.fn();
const insertSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "files") {
            return Promise.resolve(fileRow ? [fileRow] : []);
          }
          if (table.__name === "file_assets") {
            return Promise.resolve(assetRow ? [assetRow] : []);
          }
          // purchases lookups (resolvePurchaseId) — not exercised by the
          // scenarios below (owner/anon/unpaid all short-circuit before
          // reaching them), but keep this from throwing if a future test
          // reaches it.
          return { limit: () => Promise.resolve([]) };
        },
      }),
    }),
    update: (table: { __name?: string }) => {
      updateSpy(table.__name);
      return { set: () => ({ where: () => Promise.resolve() }) };
    },
    insert: (table: { __name?: string }) => ({
      values: (v: unknown) => {
        insertSpy(table.__name, v);
        return Promise.resolve();
      },
    }),
  },
}));

const mockOwnsLoadedFile = vi.fn();
vi.mock("@/lib/entitlement", () => ({
  ownsLoadedFile: (...args: unknown[]) => mockOwnsLoadedFile(...args),
}));

const mockIsOrgMember = vi.fn();
vi.mock("@/lib/authorization", () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi
    .fn()
    .mockResolvedValue("https://r2.example.com/signed"),
}));

vi.mock("@/lib/watermark/embed", () => ({
  buildWatermarkToken: vi.fn(() => "faketoken"),
  embedWatermark: vi.fn((bytes: Uint8Array) => bytes),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { NextRequest } from "next/server";
import { GET } from "../route";

function makeRequest(url = "http://localhost/files/some-slug/download") {
  return new NextRequest(url);
}

function makeProps(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function file(
  overrides: Partial<{
    id: string;
    price: number;
    userId: string;
    organizationId: string | null;
    status: string;
    downloadCount: number;
  }> = {}
) {
  return {
    id: "file-1",
    price: 500,
    userId: "creator-1",
    organizationId: null,
    status: "published",
    downloadCount: 0,
    ...overrides,
  };
}

function asset(
  overrides: Partial<{
    id: string;
    fileId: string;
    storageKey: string;
    format: string;
    originalFilename: string;
  }> = {}
) {
  return {
    id: "asset-1",
    fileId: "file-1",
    storageKey: "uploads/creator-1/abc/model.stl",
    format: "stl",
    originalFilename: "model.stl",
    ...overrides,
  };
}

function upstreamOk() {
  mockFetch.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  );
}

beforeEach(() => {
  mockUserId = null;
  fileRow = null;
  assetRow = null;
  mockFetch.mockReset();
  mockOwnsLoadedFile.mockReset();
  mockIsOrgMember.mockReset();
  mockIsOrgMember.mockResolvedValue({ member: false, role: null });
  updateSpy.mockClear();
  insertSpy.mockClear();
});

describe("GET /files/[slug]/download", () => {
  it("anon + paid published file -> 401, entitlement checked, no writes", async () => {
    mockUserId = null;
    fileRow = file({ price: 500, status: "published" });
    assetRow = asset();
    mockOwnsLoadedFile.mockResolvedValue(false);

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(401);
    expect(mockOwnsLoadedFile).toHaveBeenCalledWith(null, fileRow);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("signed-in non-owner + paid published file, no purchase -> 402, no writes", async () => {
    mockUserId = "buyer-1";
    fileRow = file({ price: 500, userId: "creator-1", status: "published" });
    assetRow = asset();
    mockOwnsLoadedFile.mockResolvedValue(false);

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(402);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("owner -> 200, and download is counted", async () => {
    mockUserId = "creator-1";
    fileRow = file({ price: 500, userId: "creator-1", status: "published" });
    assetRow = asset({ fileId: "file-1" });
    mockOwnsLoadedFile.mockResolvedValue(true);
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith("files");
    expect(insertSpy).toHaveBeenCalledWith(
      "file_downloads",
      expect.objectContaining({
        fileId: "file-1",
        fileAssetId: "asset-1",
        userId: "creator-1",
      })
    );
  });

  it("unpublished draft, price===0, non-owner -> 404 (NOT the price===0 world-downloadable bypass)", async () => {
    mockUserId = "stranger";
    fileRow = file({
      price: 0,
      userId: "creator-1",
      organizationId: null,
      status: "draft",
    });
    assetRow = asset();
    // If the draft gate didn't run first, ownsLoadedFile would return true
    // for a free file and this would leak as a 200.
    mockOwnsLoadedFile.mockResolvedValue(true);

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(404);
    // The draft gate short-circuits BEFORE the entitlement check runs.
    expect(mockOwnsLoadedFile).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unpublished draft, anon viewer -> 404, entitlement never consulted", async () => {
    mockUserId = null;
    fileRow = file({ price: 0, userId: "creator-1", status: "draft" });
    assetRow = asset();
    mockOwnsLoadedFile.mockResolvedValue(true);

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(404);
    expect(mockOwnsLoadedFile).not.toHaveBeenCalled();
  });

  it("unpublished draft, owner -> 200 (owner bypasses the draft gate)", async () => {
    mockUserId = "creator-1";
    fileRow = file({ price: 0, userId: "creator-1", status: "draft" });
    assetRow = asset();
    mockOwnsLoadedFile.mockResolvedValue(true);
    upstreamOk();

    const res = await GET(makeRequest(), makeProps("some-slug"));

    expect(res.status).toBe(200);
  });

  it("missing file row -> 404, nothing else queried", async () => {
    mockUserId = null;
    fileRow = null;

    const res = await GET(makeRequest(), makeProps("missing-slug"));

    expect(res.status).toBe(404);
    expect(mockOwnsLoadedFile).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
