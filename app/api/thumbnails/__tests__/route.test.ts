/**
 * SEC-3 — POST /api/thumbnails accepted a caller-controlled `dataUrl`
 * with no size cap and no verification that the decoded bytes were
 * actually a WebP image before PUTting them to R2 under a
 * `thumbnails/{fileId}.webp` key (later streamed back same-origin by
 * the GET route). These tests cover the reject paths the fix adds:
 * wrong data-URL prefix, oversized payload, and bytes that don't
 * carry the declared format's magic header.
 *
 * The accepted-prefix allowlist carries TWO entries. `toDataURL(type)`
 * is specified to fall back to PNG, silently, for any type the browser
 * cannot encode, and Safari decodes WebP but does not encode it — so
 * captures taken on iOS arrive as PNG. Requiring WebP 400'd every one
 * of them: visibly as "Couldn't update" on the viewer's Update-preview
 * button, and invisibly for the automatic first capture, which only
 * console.warns, so an iPhone upload simply never got a thumbnail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

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

  it("rejects a dataUrl outside the accepted prefix allowlist", async () => {
    for (const dataUrl of [
      "data:image/gif;base64,aGVsbG8=",
      "data:image/svg+xml;base64,aGVsbG8=",
      "data:text/html;base64,aGVsbG8=",
      "https://evil.example/x.webp",
    ]) {
      const res = await POST(makeRequest({ fileId: "file-1", dataUrl }));
      expect(res.status).toBe(400);
    }
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects PNG-declared bytes that aren't actually a PNG", async () => {
    // The bytes must match the format the caller declared — widening
    // the allowlist must not widen what gets past the magic-byte gate.
    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/png;base64,${Buffer.from("nope").toString("base64")}`,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not a valid PNG/i);
    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects WebP bytes smuggled under the PNG prefix, and vice versa", async () => {
    const pngUnderWebp = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/webp;base64,${(
          await sharp({
            create: {
              width: 4,
              height: 4,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer()
        ).toString("base64")}`,
      })
    );
    expect(pngUnderWebp.status).toBe(400);

    const webpUnderPng = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/png;base64,${VALID_WEBP_BYTES.toString("base64")}`,
      })
    );
    expect(webpUnderPng.status).toBe(400);

    expect(mockGenerateUploadUrl).not.toHaveBeenCalled();
  });

  it("accepts a PNG capture (Safari/iOS) and stores it as WebP", async () => {
    // The regression: Safari cannot encode WebP, so toDataURL falls
    // back to PNG and this route used to 400 every mobile capture.
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 120, g: 120, b: 120, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      })
    );

    expect(res.status).toBe(200);
    // Normalized server-side: the key, the signed content type and
    // everything downstream stay single-format regardless of which
    // encoder the capturing browser had.
    expect(mockGenerateUploadUrl).toHaveBeenCalledWith(
      "thumbnails/file-1.webp",
      "image/webp",
      300
    );

    const put = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = put[1]?.body as Buffer;
    expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(body.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("rejects an undecodable PNG rather than storing it", async () => {
    // Valid PNG signature, garbage payload — passes the magic-byte
    // gate, fails the transcode. Must 400, not 500.
    const res = await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: `data:image/png;base64,${Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from("garbage payload that is not a real PNG body"),
        ]).toString("base64")}`,
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

  it("persists the chosen camera alongside the image", async () => {
    await POST(
      makeRequest({
        fileId: "file-1",
        dataUrl: VALID_WEBP_DATA_URL,
        previewView: { direction: [0, 0.5, 0.866], framing: 0.73 },
      })
    );

    // One write: a capture and the angle it was shot from are one
    // fact, and splitting them invites a row claiming an angle its
    // thumbnail never came from.
    expect(mockDbSet).toHaveBeenCalledTimes(1);
    expect(
      (mockDbSet.mock.calls as unknown as unknown[][])[0][0]
    ).toMatchObject({
      previewDirX: 0,
      previewDirY: 0.5,
      previewDirZ: 0.866,
      previewFraming: 0.73,
    });
  });

  it("leaves the camera columns untouched for an automatic capture", async () => {
    // The automatic first capture posts no view, and null is what
    // tells the viewer to keep its own framing — writing a default
    // here would erase that distinction.
    await POST(makeRequest({ fileId: "file-1", dataUrl: VALID_WEBP_DATA_URL }));

    const written = (mockDbSet.mock.calls as unknown as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(written).toHaveProperty("thumbnailUrl");
    expect(written).not.toHaveProperty("previewDirX");
    expect(written).not.toHaveProperty("previewFraming");
  });

  it("rejects a malformed preview view rather than half-writing it", async () => {
    for (const previewView of [
      { direction: [0, 1], framing: 0.7 },
      { direction: [0, 1, 0], framing: 0 },
      { direction: [0, 1, 0], framing: -1 },
      { direction: ["a", 1, 0], framing: 0.7 },
      { framing: 0.7 },
    ]) {
      const res = await POST(
        makeRequest({
          fileId: "file-1",
          dataUrl: VALID_WEBP_DATA_URL,
          previewView,
        })
      );
      expect(res.status).toBe(400);
    }
    expect(mockDbSet).not.toHaveBeenCalled();
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
