/**
 * SEC-3 — POST /api/thumbnails accepted a caller-controlled `dataUrl`
 * with no size cap and no verification that the decoded bytes were
 * actually a WebP image before PUTting them to R2 under a
 * `thumbnails/{fileId}.webp` key (later streamed back same-origin by
 * the GET route). These tests cover the reject paths the fix adds:
 * wrong data-URL prefix, oversized payload, and bytes that don't
 * carry the WebP RIFF/WEBP magic header.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbWhere = vi.fn();
const mockDbSet = vi.fn(() => ({ where: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbWhere }) }),
    update: () => ({ set: mockDbSet }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { id: "id", userId: "userId" },
}));

const mockGenerateUploadUrl = vi.fn().mockResolvedValue("https://r2.example.com/signed-put");
vi.mock("@/lib/storage", () => ({
  generateUploadUrl: (...args: unknown[]) => mockGenerateUploadUrl(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { POST } from "../route";
import { setMockUserId } from "@/vitest.setup";

// A real 12-byte WebP RIFF header (VP8 payload bytes after are
// irrelevant to the magic-byte check).
const VALID_WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const VALID_WEBP_DATA_URL = `data:image/webp;base64,${VALID_WEBP_BYTES.toString("base64")}`;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/thumbnails", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/thumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockUserId("owner-1");
    mockGenerateUploadUrl.mockResolvedValue("https://r2.example.com/signed-put");
    mockDbWhere.mockResolvedValue([{ id: "file-1", userId: "owner-1" }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("rejects a dataUrl outside the data:image/webp;base64, prefix", async () => {
    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: "data:image/png;base64,aGVsbG8=",
      })
    );

    expect(res.status).toBe(400);
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload", async () => {
    // One char over the max base64 length the schema allows for a
    // 5MB decoded budget.
    const hugeBase64 = "A".repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4);
    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/webp;base64,${hugeBase64}`,
      })
    );

    expect(res.status).toBe(400);
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects decoded bytes that don't carry the WebP magic header", async () => {
    const fakeBytes = Buffer.from("not a webp file at all, just text");
    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/webp;base64,${fakeBytes.toString("base64")}`,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not a valid WebP/i);
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a missing fileId", async () => {
    const res = await POST(makeRequest({ dataUrl: VALID_WEBP_DATA_URL }));
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed WebP data URL and uploads it", async () => {
    const res = await POST(
      makeRequest({ fileId: "file-1", dataUrl: VALID_WEBP_DATA_URL })
    );

    expect(res.status).toBe(200);
    expect(mockGenerateUploadUrl).toHaveBeenCalledWith(
      "thumbnails/file-1.webp",
      "image/webp",
      300
    );
  });

  it("404s when the caller doesn't own the file", async () => {
    mockDbWhere.mockResolvedValue([]);
    const res = await POST(
      makeRequest({ fileId: "someone-elses-file", dataUrl: VALID_WEBP_DATA_URL })
    );

    expect(res.status).toBe(404);
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });
});
