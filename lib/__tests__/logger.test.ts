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

import { logError, buildSentryEnrichment } from "@/lib/logger";

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

  it("doesn't crash on circular-reference objects", () => {
    // Some real-world payloads (e.g. nested error chains, Stripe
    // SDK error objects with self-references) can carry cycles.
    // JSON.stringify throws on those — the safe fallback must
    // keep logError running so the underlying bug still surfaces.
    type Circular = { self?: Circular; name: string };
    const obj: Circular = { name: "loop" };
    obj.self = obj;

    expect(() => logError("circular.context", obj)).not.toThrow();
    const message = consoleSpy.mock.calls[0][1] as string;
    // The exact fallback value isn't load-bearing — what matters
    // is that the call didn't throw and SOMETHING got logged.
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("buildSentryEnrichment", () => {
  it("always includes the context tag", () => {
    const { tags } = buildSentryEnrichment("checkout.create", null);
    expect(tags.context).toBe("checkout.create");
  });

  it("promotes allowlisted domain ids to tags", () => {
    const { tags, extras } = buildSentryEnrichment("checkout.create", {
      orderId: "ord_123",
      buyerId: "user_abc",
      vendorId: "vendor-xyz",
      message: "free-form text",
    });
    // Allowlisted fields become tags (filterable / groupable).
    expect(tags.orderId).toBe("ord_123");
    expect(tags.buyerId).toBe("user_abc");
    expect(tags.vendorId).toBe("vendor-xyz");
    // Free-form text is NOT in the allowlist → extras only.
    expect(tags.message).toBeUndefined();
    // Every field appears in extras regardless of allowlist.
    expect(extras.orderId).toBe("ord_123");
    expect(extras.message).toBe("free-form text");
  });

  it("coerces numeric / boolean tag values to strings", () => {
    const { tags } = buildSentryEnrichment("api.craftcloud", {
      status: 503,
      code: 0,
      // booleans should also become strings
      errorCode: true,
    });
    expect(tags.status).toBe("503");
    expect(tags.code).toBe("0");
    expect(tags.errorCode).toBe("true");
  });

  it("ignores object/array values for tag promotion (extras only)", () => {
    const { tags, extras } = buildSentryEnrichment("upload", {
      // Nested objects can't become tag values; they go in extras.
      fileId: { nested: "something" },
      // Arrays similarly.
      orderId: ["a", "b"],
    });
    expect(tags.fileId).toBeUndefined();
    expect(tags.orderId).toBeUndefined();
    expect(extras.fileId).toEqual({ nested: "something" });
    expect(extras.orderId).toEqual(["a", "b"]);
  });

  it("unwraps Error.cause when it carries structured fields", () => {
    // `new Error(msg, { cause })` is the modern pattern for
    // attaching diagnostic context to an Error. logError should
    // surface the cause's fields just like a plain-object payload.
    const err = new Error("upstream failed", {
      cause: { orderId: "ord_cause", status: 500, retries: 3 },
    });
    const { tags, extras } = buildSentryEnrichment("worker.tick", err);
    expect(tags.orderId).toBe("ord_cause");
    expect(tags.status).toBe("500");
    expect(extras.cause).toEqual({
      orderId: "ord_cause",
      status: 500,
      retries: 3,
    });
  });

  it("returns empty extras for non-object errors", () => {
    expect(
      buildSentryEnrichment("ctx", new Error("plain")).extras
    ).toEqual({});
    expect(buildSentryEnrichment("ctx", "string error").extras).toEqual({});
    expect(buildSentryEnrichment("ctx", null).extras).toEqual({});
    expect(buildSentryEnrichment("ctx", undefined).extras).toEqual({});
  });
});

/**
 * Regression tests for Sentry event 7483761588:
 *   "Error: aborted" fired from node:_http_server → abortIncoming
 *
 * Root cause: logError() forwarded every error to Sentry including the
 * benign Node.js HTTP abort that fires when a client disconnects mid-
 * request (user navigated away, closed tab, network dropped).  The error
 * has no in-app stack frames and is not an application bug; sending it
 * to Sentry just adds noise.
 *
 * Fix: isConnectionAbort() detects both Error('aborted') and AbortError
 * and returns early from logError() before touching console or Sentry.
 */
describe("connection-abort suppression (Sentry event 7483761588)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("does NOT call console.error for the Node.js HTTP abort Error('aborted')", () => {
    // This is the exact error thrown by node:_http_server → abortIncoming
    // when the client disconnects while a server action is in-flight.
    logError("createPrintOrder", new Error("aborted"));
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("does NOT call console.error for an AbortController AbortError", () => {
    // Client-side abort signals (e.g. user navigates away during fetch)
    // produce DOMException with name 'AbortError' — same treatment.
    const err = new DOMException("Aborted", "AbortError");
    logError("createPrintOrder", err);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("DOES call console.error for real application errors", () => {
    // Sanity-check: ordinary errors must still be reported.
    logError("createPrintOrder", new Error("CraftCloud 500"));
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("DOES call console.error when message is 'abort' (not 'aborted')", () => {
    // 'abort' is not the Node.js HTTP abort string — don't over-suppress.
    logError("createPrintOrder", new Error("abort"));
    expect(consoleSpy).toHaveBeenCalledOnce();
  });
});
