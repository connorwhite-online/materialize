/**
 * SEC-1 — requestPhotoUploadUrlForUser must reject SVG uploads.
 *
 * The MCP photo presign previously allowlisted `image/svg+xml`
 * alongside jpeg/png/webp, while the web presign
 * (app/api/upload/photo-presign/route.ts) only ever allowed
 * jpeg/png/webp. SVG bytes served back same-origin from the
 * thumbnail proxies (with an uploader-controlled Content-Type and no
 * nosniff) are a stored-XSS vector, so the MCP allowlist must match
 * the web one exactly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = vi.hoisted(() => ({}) as { select?: unknown });
vi.mock("@/lib/db", () => ({
  db: mockDb,
}));
vi.mock("@/lib/files/current-version", () => ({ isCurrentAsset: () => ({}) }));
vi.mock("@/lib/db/schema", () => ({
  fileAssets: {},
  filePhotos: {},
  files: {},
  printOrders: {},
  printOrderItems: {},
  users: {},
}));
vi.mock("@/lib/studio-drafts", () => ({
  notUnsavedStudioDraft: () => true,
}));
vi.mock("@/lib/craftcloud/client", () => ({
  uploadModel: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

const mockGenerateUploadUrl = vi.fn().mockResolvedValue("https://r2.example.com/signed-put");
vi.mock("@/lib/storage", () => ({
  deleteObject: vi.fn(),
  generateUploadUrl: (...args: unknown[]) => mockGenerateUploadUrl(...args),
  objectExists: vi.fn(),
  putObject: (...args: unknown[]) => mockPutObject(...args),
}));

const mockPutObject = vi.fn();
const mockFetchModelBytes = vi.fn();
vi.mock("../fetch-model", async () => {
  class ModelFetchError extends Error {}
  return {
    ModelFetchError,
    fetchModelBytes: (...args: unknown[]) => mockFetchModelBytes(...args),
  };
});

import { importModelFromUrlForUser, requestPhotoUploadUrlForUser } from "../files";
import { ModelFetchError } from "../fetch-model";

describe("requestPhotoUploadUrlForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateUploadUrl.mockResolvedValue("https://r2.example.com/signed-put");
  });

  it("rejects image/svg+xml", async () => {
    const result = await requestPhotoUploadUrlForUser({
      userId: "user-1",
      filename: "logo.svg",
      sizeBytes: 1024,
      contentType: "image/svg+xml",
    });

    expect(result).toEqual({ error: "Unsupported photo content type" });
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/jpg", "image/png", "image/webp"])(
    "accepts %s",
    async (contentType) => {
      const result = await requestPhotoUploadUrlForUser({
        userId: "user-1",
        filename: "photo.bin",
        sizeBytes: 1024,
        contentType,
      });

      expect(result).not.toHaveProperty("error");
      expect(mockGenerateUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining("photos/user-1/"),
        contentType,
        expect.any(Number)
      );
    }
  );

  it("rejects an unrelated content type (e.g. text/html)", async () => {
    const result = await requestPhotoUploadUrlForUser({
      userId: "user-1",
      filename: "page.html",
      sizeBytes: 1024,
      contentType: "text/html",
    });

    expect(result).toEqual({ error: "Unsupported photo content type" });
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });
});

describe("importModelFromUrlForUser", () => {
  beforeEach(() => {
    mockPutObject.mockReset();
    mockFetchModelBytes.mockReset();
  });

  it("returns the fetch error as a tool error without writing to storage", async () => {
    mockFetchModelBytes.mockRejectedValue(
      new ModelFetchError("That URL points at a private address.")
    );
    const result = await importModelFromUrlForUser({
      userId: "user_1",
      url: "https://169.254.169.254/latest",
    });
    expect(result).toEqual({ error: "That URL points at a private address." });
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("asks for a filename when neither the caller nor the URL names one", async () => {
    mockFetchModelBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      urlFilename: null,
    });
    const result = await importModelFromUrlForUser({
      userId: "user_1",
      url: "https://files.example.com/download?id=abc",
    });
    expect(result).toMatchObject({ error: expect.stringContaining("Pass the filename") });
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("rejects an unsupported extension", async () => {
    mockFetchModelBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      urlFilename: "notes.pdf",
    });
    const result = await importModelFromUrlForUser({
      userId: "user_1",
      url: "https://files.example.com/notes.pdf",
    });
    expect(result).toMatchObject({ error: expect.stringContaining("Unsupported file format") });
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});

describe("importModelFromUrlForUser dedupe", () => {
  it("reuses the user's existing upload of the same bytes instead of storing a duplicate", async () => {
    mockPutObject.mockReset();
    mockFetchModelBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      urlFilename: "calibration-cube-20mm.stl",
    });
    const existing = { fileAssetId: "asset_1", fileId: "file_1", fileSlug: "calibration-cube", craftCloudModelId: "cc_1" };
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve([existing]),
    };
    mockDb.select = () => chain;
    const result = await importModelFromUrlForUser({
      userId: "user_1",
      url: "https://www.materialize.cc/review/calibration-cube-20mm.stl",
    });
    expect(result).toMatchObject({ ...existing, warnings: [expect.stringContaining("Reused")] });
    expect(mockPutObject).not.toHaveBeenCalled();
    delete mockDb.select;
  });
});
