/**
 * Tests for POST /api/upload/circuit-presign (CON-147).
 *
 * Minimal auth + validation coverage:
 *   - 401 anon
 *   - 400 missing filename / fileSize
 *   - 400 file exceeds 20MB limit
 *   - 400 unsupported type/extension
 *   - 200 accepted image types (jpg/png/webp/svg)
 *   - 200 accepted KiCad extensions (.kicad_sch, .kicad_pcb, .kicad_pro)
 *   - key rooted at circuits/${userId}/
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
  nanoid: () => "circuit-nanoid",
}));

// circuit-presign imports sanitizeFilename from presign/route
vi.mock("../../presign/route", () => ({
  sanitizeFilename: (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_"),
}));

import { POST } from "../route";

const MAX_CIRCUIT_SIZE = 20 * 1024 * 1024; // 20MB

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/upload/circuit-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId = "user-1";
  generateUploadUrlMock.mockReset();
  generateUploadUrlMock.mockResolvedValue("https://r2.example.com/circuit-put");
});

describe("POST /api/upload/circuit-presign", () => {
  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await POST(
      makeRequest({ filename: "schema.kicad_sch", contentType: "application/octet-stream", fileSize: 1000 })
    );
    expect(res.status).toBe(401);
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it("400 when filename is missing", async () => {
    const res = await POST(makeRequest({ contentType: "image/png", fileSize: 1000 }));
    expect(res.status).toBe(400);
  });

  it("400 when fileSize is missing", async () => {
    const res = await POST(makeRequest({ filename: "diagram.png", contentType: "image/png" }));
    expect(res.status).toBe(400);
  });

  it("400 when fileSize is 0", async () => {
    const res = await POST(
      makeRequest({ filename: "diagram.png", contentType: "image/png", fileSize: 0 })
    );
    expect(res.status).toBe(400);
  });

  it("400 when file exceeds 20MB limit", async () => {
    const res = await POST(
      makeRequest({
        filename: "big.png",
        contentType: "image/png",
        fileSize: MAX_CIRCUIT_SIZE + 1,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/20MB/i);
  });

  it("400 for unsupported content type (not image + not kicad extension)", async () => {
    const res = await POST(
      makeRequest({ filename: "circuit.pdf", contentType: "application/pdf", fileSize: 1000 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported/i);
  });

  it("200 for image/png with circuits/ key prefix", async () => {
    const res = await POST(
      makeRequest({ filename: "diagram.png", contentType: "image/png", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storageKey).toMatch(/^circuits\/user-1\//);
    expect(body.uploadUrl).toBe("https://r2.example.com/circuit-put");
  });

  it("200 for image/jpeg", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.jpg", contentType: "image/jpeg", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
  });

  it("200 for image/webp", async () => {
    const res = await POST(
      makeRequest({ filename: "photo.webp", contentType: "image/webp", fileSize: 5000 })
    );
    expect(res.status).toBe(200);
  });

  it("200 for image/svg+xml", async () => {
    const res = await POST(
      makeRequest({ filename: "diagram.svg", contentType: "image/svg+xml", fileSize: 2000 })
    );
    expect(res.status).toBe(200);
  });

  it("200 for .kicad_sch extension (octet-stream content type)", async () => {
    const res = await POST(
      makeRequest({
        filename: "schema.kicad_sch",
        contentType: "application/octet-stream",
        fileSize: 50_000,
      })
    );
    expect(res.status).toBe(200);
    // KiCad source files should be signed as octet-stream
    expect(generateUploadUrlMock.mock.calls[0][1]).toBe("application/octet-stream");
  });

  it("200 for .kicad_pcb extension", async () => {
    const res = await POST(
      makeRequest({ filename: "board.kicad_pcb", contentType: "", fileSize: 80_000 })
    );
    expect(res.status).toBe(200);
  });

  it("200 for .kicad_pro extension", async () => {
    const res = await POST(
      makeRequest({ filename: "project.kicad_pro", contentType: "", fileSize: 10_000 })
    );
    expect(res.status).toBe(200);
  });
});
