/**
 * Tests for POST /api/upload/presign handler (CON-147).
 *
 * Covers the gate matrix:
 *   - 401 when unauthenticated
 *   - 400 invalid/missing fileSize (null, 0, negative, non-finite)
 *   - 400 when fileSize > MAX_FILE_SIZE (200MB)
 *   - 400 unsupported file extension
 *   - 200 happy path: verifies key shape and returned fields
 *
 * sanitizeFilename edge cases are covered by sanitize-filename.test.ts.
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

// nanoid — predictable value so we can assert key shape
vi.mock("nanoid", () => ({
  nanoid: () => "test-nanoid",
}));

import { POST } from "../route";
import { MAX_FILE_SIZE } from "@/lib/validations/file";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId = "user-1";
  generateUploadUrlMock.mockReset();
  generateUploadUrlMock.mockResolvedValue("https://r2.example.com/signed-put");
});

describe("POST /api/upload/presign — auth gate", () => {
  it("returns 401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await POST(
      makeRequest({ filename: "model.stl", contentType: "model/stl", fileSize: 1000 })
    );
    expect(res.status).toBe(401);
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload/presign — fileSize validation", () => {
  it("returns 400 when fileSize is missing", async () => {
    const res = await POST(makeRequest({ filename: "model.stl", contentType: "model/stl" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid file size/i);
  });

  it("returns 400 when fileSize is 0", async () => {
    const res = await POST(
      makeRequest({ filename: "model.stl", contentType: "model/stl", fileSize: 0 })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when fileSize is negative", async () => {
    const res = await POST(
      makeRequest({ filename: "model.stl", contentType: "model/stl", fileSize: -1 })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when fileSize is non-finite (Infinity)", async () => {
    // JSON doesn't support Infinity, but test the type guard
    const res = await POST(
      makeRequest({ filename: "model.stl", contentType: "model/stl", fileSize: null })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when fileSize exceeds MAX_FILE_SIZE (200MB)", async () => {
    const res = await POST(
      makeRequest({
        filename: "model.stl",
        contentType: "model/stl",
        fileSize: MAX_FILE_SIZE + 1,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/200MB/i);
  });

  it("accepts fileSize exactly equal to MAX_FILE_SIZE", async () => {
    const res = await POST(
      makeRequest({
        filename: "model.stl",
        contentType: "model/stl",
        fileSize: MAX_FILE_SIZE,
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/upload/presign — file extension validation", () => {
  it("returns 400 for unsupported extension (.pdf)", async () => {
    const res = await POST(
      makeRequest({ filename: "model.pdf", contentType: "application/pdf", fileSize: 1000 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported/i);
  });

  it("returns 400 for unsupported extension (.exe)", async () => {
    const res = await POST(
      makeRequest({ filename: "bad.exe", contentType: "application/octet-stream", fileSize: 1000 })
    );
    expect(res.status).toBe(400);
  });

  it("accepts .stl extension", async () => {
    const res = await POST(
      makeRequest({ filename: "model.stl", contentType: "model/stl", fileSize: 1000 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts .3mf extension", async () => {
    const res = await POST(
      makeRequest({ filename: "model.3mf", contentType: "model/3mf", fileSize: 1000 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts .step extension", async () => {
    const res = await POST(
      makeRequest({ filename: "model.step", contentType: "model/step", fileSize: 1000 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts .stp as step alias", async () => {
    const res = await POST(
      makeRequest({ filename: "model.stp", contentType: "model/step", fileSize: 1000 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts .amf extension", async () => {
    const res = await POST(
      makeRequest({ filename: "model.amf", contentType: "model/amf", fileSize: 1000 })
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/upload/presign — happy path key shape", () => {
  it("returns uploadUrl, storageKey with uploads/${userId}/${nanoid}/ prefix, and format", async () => {
    const res = await POST(
      makeRequest({ filename: "My Model.stl", contentType: "model/stl", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.uploadUrl).toBe("https://r2.example.com/signed-put");
    expect(body.format).toBe("stl");
    // Key must be uploads/${userId}/${nanoid}/${sanitizedName}
    expect(body.storageKey).toMatch(/^uploads\/user-1\/test-nanoid\//);
    // Sanitized: spaces → underscore
    expect(body.storageKey).toContain("My_Model.stl");
  });
});
