/**
 * Tests for POST /api/upload/photo-presign (CON-147).
 *
 * Minimal auth + validation coverage:
 *   - 401 anon
 *   - 400 missing filename
 *   - 400 invalid/missing fileSize
 *   - 400 file exceeds 10MB limit
 *   - 400 unsupported content type
 *   - 200 happy path with photos/ key prefix
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = "user-1";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

const generateUploadUrlMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  generateUploadUrl: (...args: unknown[]) => generateUploadUrlMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: () => "photo-nanoid",
}));

// photo-presign imports sanitizeFilename from presign/route — mock it
vi.mock("../../presign/route", () => ({
  sanitizeFilename: (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_"),
}));

import { POST } from "../route";

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/upload/photo-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId = "user-1";
  generateUploadUrlMock.mockReset();
  generateUploadUrlMock.mockResolvedValue("https://r2.example.com/photo-put");
});

describe("POST /api/upload/photo-presign", () => {
  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await POST(
      makeRequest({ filename: "photo.jpg", contentType: "image/jpeg", fileSize: 1000 })
    );
    expect(res.status).toBe(401);
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it("400 when filename is missing", async () => {
    const res = await POST(makeRequest({ contentType: "image/jpeg", fileSize: 1000 }));
    expect(res.status).toBe(400);
  });

  it("400 when fileSize is missing", async () => {
    const res = await POST(makeRequest({ filename: "photo.jpg", contentType: "image/jpeg" }));
    expect(res.status).toBe(400);
  });

  it("400 when fileSize is 0", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.jpg", contentType: "image/jpeg", fileSize: 0 })
    );
    expect(res.status).toBe(400);
  });

  it("400 when file exceeds 10MB limit", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.jpg", contentType: "image/jpeg", fileSize: MAX_PHOTO_SIZE + 1 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/10MB/i);
  });

  it("400 for unsupported content type (.pdf)", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.pdf", contentType: "application/pdf", fileSize: 1000 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported/i);
  });

  it("200 for image/jpeg with photos/ key prefix", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.jpg", contentType: "image/jpeg", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe("https://r2.example.com/photo-put");
    expect(body.storageKey).toMatch(/^photos\/user-1\//);
  });

  it("200 for image/png", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.png", contentType: "image/png", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
  });

  it("200 for image/webp", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.webp", contentType: "image/webp", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
  });

  it("places ownership evidence under the orphan-cleaned uploads prefix", async () => {
    const res = await POST(
      makeRequest({
        filename: "prototype.jpg",
        contentType: "image/jpeg",
        fileSize: 5000,
        purpose: "ownership_claim",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storageKey).toMatch(
      /^uploads\/user-1\/ownership-claim-photos\//
    );
  });
});
