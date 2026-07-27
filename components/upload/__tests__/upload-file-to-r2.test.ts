import { describe, it, expect, vi, beforeEach } from "vitest";

// MONEY-3: uploadFileToR2 is the extracted presign -> R2 PUT sequence
// previously copy-pasted across run-anon-checkout.ts,
// use-start-print-flow.ts, run-create-listing.ts, and
// cart-context.tsx's materializeLocalItems — with drifted error
// strings and inconsistent reportClientError coverage. This is its
// own characterization + contract test, independent of any one
// caller. Model: components/upload/__tests__/run-create-listing.test.ts
// (FakeXHR pattern) + components/print/__tests__/run-anon-checkout.test.ts.

const reportClientErrorImpl = vi.fn();
vi.mock("@/lib/observability/report-client-error", () => ({
  reportClientError: (...args: unknown[]) => reportClientErrorImpl(...args),
}));

import { uploadFileToR2 } from "../upload-file-to-r2";

// Minimal XMLHttpRequest stub — mirrors the FakeXHR used in
// run-create-listing.test.ts. Fires the progress + load/error events
// as a microtask on send().
class FakeXHR {
  static nextStatus = 200;
  static nextError: "network" | null = null;
  static lastOpenedUrl: string | null = null;

  _uploadListeners = new Map<string, ((ev: ProgressEvent) => void)[]>();
  upload = {
    addEventListener: (type: string, cb: (ev: ProgressEvent) => void) => {
      const list = this._uploadListeners.get(type) ?? [];
      list.push(cb);
      this._uploadListeners.set(type, list);
    },
  };
  _listeners = new Map<string, (() => void)[]>();
  status = 200;

  addEventListener(type: string, cb: () => void) {
    const list = this._listeners.get(type) ?? [];
    list.push(cb);
    this._listeners.set(type, list);
  }
  open(_method: string, url: string) {
    FakeXHR.lastOpenedUrl = url;
  }
  setRequestHeader() {}
  send() {
    const progList = this._uploadListeners.get("progress") ?? [];
    for (const cb of progList) {
      cb({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    }
    queueMicrotask(() => {
      if (FakeXHR.nextError === "network") {
        for (const cb of this._listeners.get("error") ?? []) cb();
        return;
      }
      this.status = FakeXHR.nextStatus;
      for (const cb of this._listeners.get("load") ?? []) cb();
    });
  }
}

function makeFile(name = "carabiner.stl"): File {
  return new File(["hello world"], name, {
    type: "application/octet-stream",
  });
}

function mockPresign(opts?: { status?: number; body?: unknown }) {
  const status = opts?.status ?? 200;
  const body = opts?.body ?? {
    uploadUrl: "https://r2.example/upload-url",
    storageKey: "uploads/u/abc/carabiner.stl",
    format: "stl",
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("uploadFileToR2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    FakeXHR.nextStatus = 200;
    FakeXHR.nextError = null;
    FakeXHR.lastOpenedUrl = null;
    // @ts-expect-error — stub for test
    globalThis.XMLHttpRequest = FakeXHR;
  });

  it("happy path: returns storageKey + format and reports nothing", async () => {
    mockPresign();
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({
      storageKey: "uploads/u/abc/carabiner.stl",
      format: "stl",
    });
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });

  it("PUTs to the exact uploadUrl the presign response returned", async () => {
    mockPresign();
    await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(FakeXHR.lastOpenedUrl).toBe("https://r2.example/upload-url");
  });

  it("forwards progress events to onProgress as a 0-100 percent", async () => {
    mockPresign();
    const onProgress = vi.fn();
    await uploadFileToR2({ file: makeFile(), kind: "anon-print", onProgress });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("defaults the presigned filename to file.name", async () => {
    const fetchSpy = mockPresign();
    await uploadFileToR2({ file: makeFile("part.stl"), kind: "anon-print" });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.filename).toBe("part.stl");
  });

  it("uses the explicit filename override when given (cart-materialize passes originalFilename)", async () => {
    const fetchSpy = mockPresign();
    await uploadFileToR2({
      file: makeFile("blob-name.stl"),
      filename: "my-cool-part.stl",
      kind: "cart-materialize",
    });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.filename).toBe("my-cool-part.stl");
  });

  it("presign non-OK: returns the server error message AND reports it", async () => {
    mockPresign({ status: 413, body: { error: "File exceeds 200MB limit" } });
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({ error: "File exceeds 200MB limit" });
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "upload.presign-failed",
      expect.any(Error),
      expect.objectContaining({ status: 413, kind: "anon-print" })
    );
  });

  it("presign non-OK with no body error: falls back to a status-coded message AND reports it", async () => {
    mockPresign({ status: 500, body: {} });
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({ error: "Upload presign failed (500)" });
    expect(reportClientErrorImpl).toHaveBeenCalledTimes(1);
  });

  it("presign network error: returns a friendly error AND reports it", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({
      error: "Couldn't reach the upload service. Please try again.",
    });
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "upload.presign-network-error",
      expect.any(Error),
      expect.objectContaining({ kind: "anon-print" })
    );
  });

  it("R2 PUT non-2xx: returns an 'R2 upload failed' error AND reports it with the storageKey", async () => {
    mockPresign();
    FakeXHR.nextStatus = 403;
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({ error: "R2 upload failed (403)" });
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "upload.r2-put-failed",
      expect.any(Error),
      expect.objectContaining({
        status: 403,
        kind: "anon-print",
        storageKey: "uploads/u/abc/carabiner.stl",
      })
    );
  });

  it("R2 PUT network/CORS error: returns a friendly error AND reports it", async () => {
    mockPresign();
    FakeXHR.nextError = "network";
    const result = await uploadFileToR2({ file: makeFile(), kind: "anon-print" });
    expect(result).toEqual({
      error: "Couldn't reach R2 (network or CORS). Please try again.",
    });
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "upload.r2-put-network-error",
      expect.any(Error),
      expect.objectContaining({ kind: "anon-print" })
    );
  });

  it("tags every reportClientError call with the caller-provided kind", async () => {
    mockPresign();
    FakeXHR.nextStatus = 500;
    await uploadFileToR2({ file: makeFile(), kind: "cart-materialize" });
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "upload.r2-put-failed",
      expect.any(Error),
      expect.objectContaining({ kind: "cart-materialize" })
    );
  });
});
