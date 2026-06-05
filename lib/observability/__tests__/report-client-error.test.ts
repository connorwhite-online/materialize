import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
const captureMessage = vi.fn();
const setTag = vi.fn();
const setExtras = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: unknown) => void) => fn({ setTag, setExtras }),
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { reportClientError } from "../report-client-error";

describe("reportClientError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures an Error with the context tag and extras", () => {
    const err = new Error("R2 upload failed (500)");
    reportClientError("upload.r2-put-failed", err, { status: 500 });
    expect(setTag).toHaveBeenCalledWith("context", "upload.r2-put-failed");
    expect(setExtras).toHaveBeenCalledWith({ status: 500 });
    expect(captureException).toHaveBeenCalledWith(err);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("captures a non-Error as a message", () => {
    reportClientError("upload.r2-put-failed", "boom");
    expect(captureMessage).toHaveBeenCalledWith(
      "upload.r2-put-failed: boom",
      "error"
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("never throws if Sentry blows up", () => {
    setTag.mockImplementationOnce(() => {
      throw new Error("sentry down");
    });
    expect(() => reportClientError("ctx", new Error("x"))).not.toThrow();
  });
});
