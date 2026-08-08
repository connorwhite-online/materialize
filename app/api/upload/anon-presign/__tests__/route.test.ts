import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/upload/anon-presign — the only endpoint that lets a caller
 * with no session cause a write into our R2 bucket. Tests here are
 * about keeping that surface narrow: rate limited, size/format capped,
 * confined to its own prefix, and never issuing a URL without first
 * recording the grant that authorizes redeeming it.
 */

const checkAnonUploadLimitMock = vi.fn();
const insertValuesMock = vi.fn();
const generateUploadUrlMock = vi.fn();

vi.mock("@/lib/uploads/anon-grants", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/uploads/anon-grants")
  >("@/lib/uploads/anon-grants");
  return {
    ...actual,
    checkAnonUploadLimit: (...a: unknown[]) => checkAnonUploadLimitMock(...a),
  };
});

vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: (v: unknown) => insertValuesMock(v) }) },
}));

vi.mock("@/lib/db/schema", () => ({ anonUploadGrants: {} }));

vi.mock("@/lib/storage", () => ({
  generateUploadUrl: (...a: unknown[]) => generateUploadUrlMock(...a),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...a: unknown[]) => logErrorMock(...a),
}));

import { POST } from "../route";
import { ANON_UPLOAD_PREFIX } from "@/lib/uploads/anon-grants";

function req(
  body: unknown = {
    filename: "carabiner.stl",
    contentType: "application/octet-stream",
    fileSize: 1024,
  },
  headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" }
) {
  return new Request("http://localhost/api/upload/anon-presign", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/upload/anon-presign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAnonUploadLimitMock.mockResolvedValue({ ok: true });
    insertValuesMock.mockResolvedValue(undefined);
    generateUploadUrlMock.mockResolvedValue("https://r2.test/put");
  });

  it("issues a presigned URL under the anon prefix", async () => {
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.uploadUrl).toBe("https://r2.test/put");
    expect(body.format).toBe("stl");
    expect(body.storageKey.startsWith(ANON_UPLOAD_PREFIX)).toBe(true);
    expect(body.storageKey.endsWith("/carabiner.stl")).toBe(true);
    // Never under the authed users' prefix.
    expect(body.storageKey.startsWith("uploads/")).toBe(false);
  });

  it("records the grant before handing out the URL", async () => {
    await POST(req());

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: "carabiner.stl",
        fileSize: 1024,
        ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    // The row is the rate-limit tally AND the authorization record; a
    // URL without one would be a write we can neither count nor verify.
    const insertOrder = insertValuesMock.mock.invocationCallOrder[0];
    const signOrder = generateUploadUrlMock.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(signOrder);
    // The raw IP is never persisted.
    expect(JSON.stringify(insertValuesMock.mock.calls[0][0])).not.toContain(
      "203.0.113.7"
    );
  });

  it("grants a distinct key per request", async () => {
    const a = await (await POST(req())).json();
    const b = await (await POST(req())).json();
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it("429s with Retry-After when rate limited, without signing anything", async () => {
    checkAnonUploadLimitMock.mockResolvedValue({
      ok: false,
      retryAfterSeconds: 120,
    });

    const res = await POST(req());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("400s when the client address can't be determined", async () => {
    const res = await POST(req(undefined, {}));

    expect(res.status).toBe(400);
    // Stripping the header must not be a way around the cap.
    expect(checkAnonUploadLimitMock).not.toHaveBeenCalled();
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file", async () => {
    const res = await POST(
      req({ filename: "big.stl", fileSize: 201 * 1024 * 1024 })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("200MB");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it.each([[0], [-1], ["abc"], [undefined]])(
    "rejects invalid fileSize %s",
    async (fileSize) => {
      const res = await POST(req({ filename: "a.stl", fileSize }));
      expect(res.status).toBe(400);
      expect(generateUploadUrlMock).not.toHaveBeenCalled();
    }
  );

  it("rejects an unsupported format", async () => {
    const res = await POST(req({ filename: "payload.exe", fileSize: 10 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Unsupported file format");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a missing filename", async () => {
    const res = await POST(req({ fileSize: 10 }));
    expect(res.status).toBe(400);
  });

  // Path separators in the name must not escape the prefix.
  it("sanitizes a traversal-shaped filename", async () => {
    const res = await POST(
      req({ filename: "../../etc/passwd.stl", fileSize: 10 })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.storageKey.startsWith(ANON_UPLOAD_PREFIX)).toBe(true);
    expect(body.storageKey).not.toContain("..");
  });

  it("500s without leaking detail when signing fails", async () => {
    generateUploadUrlMock.mockRejectedValue(new Error("R2 exploded"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create upload URL" });
    expect(logErrorMock).toHaveBeenCalled();
  });
});
