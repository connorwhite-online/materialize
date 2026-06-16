/**
 * Tests for lib/storage.ts (CON-147).
 *
 * Strategy: mock @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
 * at the module level so the S3Client is never instantiated for real.
 * Also mock lib/env's requireEnv to return test values without needing
 * actual environment variables.
 *
 * Important: vi.mock factories are hoisted to the top of the file by
 * Vitest's Babel transform. Class / variable references inside them
 * must be defined WITHIN the factory (not in the outer module scope).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── mock @aws-sdk/client-s3 ────────────────────────────────
// All Commands and the S3Client need to be real constructors since
// storage.ts calls `new XCommand(...)` and `new S3Client(...)`.
// We capture the mock `send` via a module-level mock function that
// vitest provides but we reference only through the factory closure.

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  // All references are local to the factory — no hoisting issue.
  class S3Client {
    send(...args: unknown[]) {
      return sendMock(...args);
    }
  }
  class PutObjectCommand {
    _cmd = "Put";
    params: unknown;
    constructor(params: unknown) { this.params = params; }
  }
  class GetObjectCommand {
    _cmd = "Get";
    params: unknown;
    constructor(params: unknown) { this.params = params; }
  }
  class HeadObjectCommand {
    _cmd = "Head";
    params: unknown;
    constructor(params: unknown) { this.params = params; }
  }
  class DeleteObjectCommand {
    _cmd = "Delete";
    params: unknown;
    constructor(params: unknown) { this.params = params; }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
  };
});

// ─── mock @aws-sdk/s3-request-presigner ─────────────────────

const getSignedUrlMock = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

// ─── mock lib/env ────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    const vals: Record<string, string> = {
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET_NAME: "test-bucket",
    };
    if (!(key in vals)) throw new Error(`requireEnv: ${key} not set`);
    return vals[key];
  },
}));

// ─── import under test ──────────────────────────────────────

import {
  generateUploadUrl,
  generateDownloadUrl,
  objectExists,
  deleteObject,
} from "../storage";

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
});

// ─── generateUploadUrl ───────────────────────────────────────

describe("generateUploadUrl", () => {
  it("returns the signed URL from getSignedUrl", async () => {
    getSignedUrlMock.mockResolvedValue("https://r2.example.com/signed-put");

    const url = await generateUploadUrl("uploads/user-1/abc/model.stl", "model/stl");
    expect(url).toBe("https://r2.example.com/signed-put");
    expect(getSignedUrlMock).toHaveBeenCalledOnce();
    // Verify a PutObjectCommand was passed
    const [, cmd] = getSignedUrlMock.mock.calls[0] as [unknown, { _cmd: string }];
    expect(cmd._cmd).toBe("Put");
  });

  it("propagates errors from getSignedUrl", async () => {
    getSignedUrlMock.mockRejectedValue(new Error("presign failed"));
    await expect(
      generateUploadUrl("uploads/user-1/abc/model.stl", "model/stl")
    ).rejects.toThrow("presign failed");
  });
});

// ─── generateDownloadUrl ─────────────────────────────────────

describe("generateDownloadUrl", () => {
  it("returns the signed download URL", async () => {
    getSignedUrlMock.mockResolvedValue("https://r2.example.com/signed-get");

    const url = await generateDownloadUrl("uploads/user-1/abc/model.stl");
    expect(url).toBe("https://r2.example.com/signed-get");
    const [, cmd] = getSignedUrlMock.mock.calls[0] as [unknown, { _cmd: string }];
    expect(cmd._cmd).toBe("Get");
  });

  it("propagates errors from getSignedUrl", async () => {
    getSignedUrlMock.mockRejectedValue(new Error("get presign failed"));
    await expect(generateDownloadUrl("some/key")).rejects.toThrow("get presign failed");
  });
});

// ─── objectExists ────────────────────────────────────────────

describe("objectExists", () => {
  it("returns { exists: true, sizeBytes } when HeadObject succeeds", async () => {
    sendMock.mockResolvedValue({ ContentLength: 2048 });

    const result = await objectExists("uploads/user-1/abc/model.stl");
    expect(result).toEqual({ exists: true, sizeBytes: 2048 });
  });

  it("returns { exists: false } for a 404 status from HeadObject", async () => {
    const notFoundErr = Object.assign(new Error("Not Found"), {
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValue(notFoundErr);

    const result = await objectExists("uploads/user-1/missing/model.stl");
    expect(result).toEqual({ exists: false });
  });

  it("returns { exists: false } for NotFound error name", async () => {
    const notFoundErr = Object.assign(new Error("NotFound"), { name: "NotFound" });
    sendMock.mockRejectedValue(notFoundErr);

    const result = await objectExists("some/key");
    expect(result).toEqual({ exists: false });
  });

  it("returns { exists: false } for NoSuchKey error name", async () => {
    const noSuchKeyErr = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    sendMock.mockRejectedValue(noSuchKeyErr);

    const result = await objectExists("some/key");
    expect(result).toEqual({ exists: false });
  });

  it("re-throws unexpected errors (not 404/NotFound/NoSuchKey)", async () => {
    const unexpectedErr = Object.assign(new Error("Network error"), {
      $metadata: { httpStatusCode: 503 },
    });
    sendMock.mockRejectedValue(unexpectedErr);

    await expect(objectExists("some/key")).rejects.toThrow("Network error");
  });

  it("defaults sizeBytes to 0 when ContentLength is absent", async () => {
    sendMock.mockResolvedValue({}); // no ContentLength
    const result = await objectExists("some/key");
    expect(result).toEqual({ exists: true, sizeBytes: 0 });
  });
});

// ─── deleteObject ────────────────────────────────────────────

describe("deleteObject", () => {
  it("calls S3Client.send with DeleteObjectCommand", async () => {
    sendMock.mockResolvedValue({});
    await deleteObject("uploads/user-1/abc/model.stl");
    expect(sendMock).toHaveBeenCalledOnce();
    const [cmd] = sendMock.mock.calls[0] as [{ _cmd: string }];
    expect(cmd._cmd).toBe("Delete");
  });

  it("propagates errors from S3Client.send", async () => {
    sendMock.mockRejectedValue(new Error("delete failed"));
    await expect(deleteObject("some/key")).rejects.toThrow("delete failed");
  });
});
