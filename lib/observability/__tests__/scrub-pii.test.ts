import { describe, it, expect } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { scrubPiiFromEvent } from "../scrub-pii";

/**
 * Regression tests for scrubPiiFromEvent (Sentry beforeSend hook).
 *
 * Root-cause: the function scrubbed PII from request headers/body and
 * breadcrumbs, but left exception messages and the top-level Sentry
 * `message` field untouched.  Any error message that accidentally
 * included a user's email address (e.g. "User alice@example.com not
 * found") would therefore arrive in the Sentry dashboard unredacted.
 *
 * The fix extends the scrub to:
 *   - event.exception.values[*].value  (Error.message on the server)
 *   - event.message                    (captureMessage() payload)
 */

const HINT = {} as EventHint;

describe("scrubPiiFromEvent", () => {
  // ---------------------------------------------------------------------------
  // Exception message scrubbing (server-side Error objects)
  // ---------------------------------------------------------------------------

  it("redacts email addresses embedded in exception values", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: "Error",
            value: "User alice@example.com not found in tenant xyz",
          },
        ],
      },
    };

    const result = scrubPiiFromEvent(event, HINT);

    expect(result).not.toBeNull();
    const msg = result!.exception?.values?.[0]?.value ?? "";
    expect(msg).not.toContain("alice@example.com");
    expect(msg).toContain("[redacted]");
    // Non-PII text is preserved
    expect(msg).toContain("not found in tenant xyz");
  });

  it("handles multiple email addresses in a single exception value", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: "Error",
            value:
              "Conflict: bob@example.com already assigned to carol@example.com",
          },
        ],
      },
    };

    const result = scrubPiiFromEvent(event, HINT);
    const msg = result!.exception?.values?.[0]?.value ?? "";
    expect(msg).not.toContain("bob@example.com");
    expect(msg).not.toContain("carol@example.com");
  });

  it("leaves exception values without email addresses unchanged", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{ type: "TypeError", value: "Cannot read properties of null" }],
      },
    };

    const result = scrubPiiFromEvent(event, HINT);
    expect(result!.exception?.values?.[0]?.value).toBe(
      "Cannot read properties of null"
    );
  });

  it("handles an event with no exception gracefully", () => {
    const event: ErrorEvent = { type: undefined };
    expect(() => scrubPiiFromEvent(event, HINT)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Top-level message scrubbing (captureMessage() calls)
  // ---------------------------------------------------------------------------

  it("redacts email addresses in the top-level event message", () => {
    const event: ErrorEvent = {
      type: undefined,
      message:
        "fingerprintAndPersistAsset.fetch: failed for user dave@example.com",
    };

    const result = scrubPiiFromEvent(event, HINT);

    expect(result!.message).not.toContain("dave@example.com");
    expect(result!.message).toContain("[redacted]");
  });

  it("leaves a top-level message without PII unchanged", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "checkOrderStatus: order not found",
    };

    const result = scrubPiiFromEvent(event, HINT);
    expect(result!.message).toBe("checkOrderStatus: order not found");
  });

  // ---------------------------------------------------------------------------
  // Existing functionality stays intact
  // ---------------------------------------------------------------------------

  it("still strips sensitive request headers", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        headers: {
          cookie: "session=abc123",
          authorization: "Bearer tok",
          "x-clerk-session": "sess_xyz",
          "content-type": "application/json",
        },
      },
    };

    const result = scrubPiiFromEvent(event, HINT);
    const h = result!.request!.headers as Record<string, string>;
    expect(h["cookie"]).toBe("[redacted]");
    expect(h["authorization"]).toBe("[redacted]");
    expect(h["x-clerk-session"]).toBe("[redacted]");
    expect(h["content-type"]).toBe("application/json");
  });

  it("still redacts emails from breadcrumb messages", () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        { message: "Looked up user eve@example.com", category: "info" },
        { message: "No PII here", category: "info" },
      ],
    };

    const result = scrubPiiFromEvent(event, HINT);
    const bcs = result!.breadcrumbs as Array<{ message?: string }>;
    expect(bcs[0].message).not.toContain("eve@example.com");
    expect(bcs[0].message).toContain("[redacted]");
    expect(bcs[1].message).toBe("No PII here");
  });

  it("never returns null (events are scrubbed, not dropped)", () => {
    const result = scrubPiiFromEvent({ type: undefined }, HINT);
    expect(result).not.toBeNull();
  });
});
