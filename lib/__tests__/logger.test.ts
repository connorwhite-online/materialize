import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test for Sentry event ae0a536f:
 *   "fingerprintAndPersistAsset.fetch: [object Object]"
 *
 * Root cause: logError() called String() on a plain object argument,
 * producing the useless "[object Object]" in the console/Sentry message.
 *
 * The fix: use JSON.stringify() for plain objects so the full payload
 * (including the HTTP status code) is visible in the error event.
 *
 * We verify the serialised message via console.error spy because the
 * Sentry SDK is loaded via a dynamic require() inside a try/catch and is
 * not reliably intercepted by vi.mock in this ESM test environment. The
 * second argument to console.error is exactly the `message` variable that
 * also flows into Sentry.captureMessage(), so the assertion is equivalent.
 */

import { logError } from "@/lib/logger";

describe("logError", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress console.error output during tests while still capturing calls.
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("serialises a plain object to JSON — NOT to [object Object]", () => {
    // This is the exact call site that caused Sentry event ae0a536f.
    logError("fingerprintAndPersistAsset.fetch", {
      assetId: "abc-123",
      status: 404,
    });

    expect(consoleSpy).toHaveBeenCalledOnce();
    // console.error(`[${context}]`, message, ...) — message is the second arg.
    const message = consoleSpy.mock.calls[0][1] as string;

    // Before the fix: String({…}) → "[object Object]"
    expect(message).not.toBe("[object Object]");

    // After the fix: JSON.stringify({…}) → '{"assetId":"abc-123","status":404}'
    expect(message).toContain("404");
    expect(message).toContain("abc-123");
  });

  it("serialises the autoArchive plain-object call site to JSON as well", () => {
    logError("fingerprintAndPersistAsset.autoArchive", {
      fileId: "file-xyz",
      ownerUserId: "user-1",
      collidedWithFileId: "file-abc",
    });

    const message = consoleSpy.mock.calls[0][1] as string;
    expect(message).not.toBe("[object Object]");
    expect(message).toContain("file-xyz");
    expect(message).toContain("file-abc");
  });

  it("uses Error.message when an actual Error is passed", () => {
    logError("some.context", new Error("something went wrong"));

    const message = consoleSpy.mock.calls[0][1] as string;
    expect(message).toBe("something went wrong");
    expect(message).not.toContain("[object");
  });

  it("uses String() for non-object, non-Error primitives", () => {
    logError("ctx", "raw string error");

    const message = consoleSpy.mock.calls[0][1] as string;
    expect(message).toBe("raw string error");
  });

  it("handles null without throwing", () => {
    expect(() => logError("ctx", null)).not.toThrow();
    const message = consoleSpy.mock.calls[0][1] as string;
    expect(message).toBe("null");
  });
});
