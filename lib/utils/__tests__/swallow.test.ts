import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { logError } from "@/lib/logger";
import { swallow } from "../swallow";

describe("swallow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("resolves with the value on success and never touches logError", async () => {
    const result = await swallow(Promise.resolve([1, 2, 3]), "ok-query");
    expect(result).toEqual([1, 2, 3]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("falls back to an empty array on rejection", async () => {
    const result = await swallow(
      Promise.reject(new Error("boom")),
      "failing-query"
    );
    expect(result).toEqual([]);
  });

  it("routes the failure through logError with a swallow.-prefixed context", async () => {
    await swallow(Promise.reject(new Error("boom")), "failing-query");
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "swallow.failing-query",
      expect.any(Error)
    );
  });

  it("wraps the original error in a clean, application-named Error rather than passing it through raw", async () => {
    const original = new Error("ECONNRESET");
    await swallow(Promise.reject(original), "failing-query");
    const loggedError = (logError as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Error;
    // The logged error must NOT be the raw driver error (its message
    // would match the sentry ignoreErrors connection-noise filter and
    // get silently dropped) — it must be a distinct wrapper.
    expect(loggedError).not.toBe(original);
    expect(loggedError.message).not.toBe("ECONNRESET");
    expect(loggedError.message).toContain("failing-query");
    // The original error is still reachable for debugging.
    expect(loggedError.cause).toBe(original);
  });

  it("still warns to the console for local/dev visibility", async () => {
    await swallow(Promise.reject(new Error("boom")), "failing-query");
    expect(console.warn).toHaveBeenCalledWith(
      "[failing-query] non-fatal:",
      expect.any(Error)
    );
  });
});
