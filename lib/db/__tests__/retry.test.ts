import { describe, it, expect, vi } from "vitest";
import { isTransientConnectionError, withDbRetry } from "../retry";

describe("isTransientConnectionError", () => {
  it("matches Neon/PG connection-drop messages", () => {
    for (const msg of [
      "Connection terminated unexpectedly",
      "Connection closed",
      "terminating connection due to administrator command",
      "socket hang up",
      "server closed the connection unexpectedly",
      "fetch failed",
    ]) {
      expect(isTransientConnectionError(new Error(msg)), msg).toBe(true);
    }
  });

  it("matches by error code (Node socket + PG class)", () => {
    expect(isTransientConnectionError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientConnectionError(Object.assign(new Error("x"), { code: "57P01" }))).toBe(true);
  });

  it("walks the cause chain", () => {
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    });
    expect(isTransientConnectionError(wrapped)).toBe(true);
  });

  it("is false for real query / app errors", () => {
    expect(isTransientConnectionError(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(isTransientConnectionError(new Error("column does not exist"))).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError("nope")).toBe(false);
  });

  it("does not loop forever on a self-referential cause", () => {
    const e = new Error("boom") as Error & { cause?: unknown };
    e.cause = e;
    expect(isTransientConnectionError(e)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns the first result when the thunk succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withDbRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on a transient connection error, then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce("recovered");
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up and rethrows after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Connection closed");
    });
    await expect(withDbRetry(fn, { retries: 2, baseDelayMs: 0 })).rejects.toThrow(
      "Connection closed"
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry a non-connection error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("duplicate key value");
    });
    await expect(withDbRetry(fn, { baseDelayMs: 0 })).rejects.toThrow(
      "duplicate key value"
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
