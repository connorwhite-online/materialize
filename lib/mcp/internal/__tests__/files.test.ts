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

vi.mock("@/lib/db", () => ({
  db: {},
}));
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
}));

import { requestPhotoUploadUrlForUser } from "../files";

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
