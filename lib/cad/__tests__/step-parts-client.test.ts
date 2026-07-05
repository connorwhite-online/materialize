import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  searchParts,
  downloadAndCacheStep,
  stepCacheKey,
  StepPartsNetworkError,
} from "@/lib/cad/step-parts/client";
import type { StepPartRecord } from "@/lib/cad/step-parts/types";
import { objectExists, putObject } from "@/lib/storage";

// Mock R2 — the client caches verified STEP bytes; tests assert the write,
// never touch a real bucket. Per vitest.setup.ts conventions.
vi.mock("@/lib/storage", () => ({
  objectExists: vi.fn(async () => ({ exists: false })),
  putObject: vi.fn(async () => undefined),
}));

const mockedObjectExists = vi.mocked(objectExists);
const mockedPutObject = vi.mocked(putObject);

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function bytesResponse(bytes: Uint8Array, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockedObjectExists.mockReset().mockResolvedValue({ exists: false });
  mockedPutObject.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stepCacheKey", () => {
  it("keys by id + hash and sanitizes the id", () => {
    expect(stepCacheKey("iso4762/m3x12", "abc123")).toBe(
      "cad-parts/step-parts/iso4762_m3x12/abc123.step"
    );
  });
});

describe("searchParts", () => {
  it("parses a { parts: [...] } payload, tolerating snake_case fields", () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        parts: [
          { id: "iso4762_m3x12", sha256: "aa", byte_size: 10, step_url: "https://x/y.step", standard: "ISO 4762" },
          { id: "bad" }, // missing required fields → dropped
        ],
      })
    );
    return searchParts("m3 cap screw").then((rows) => {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "iso4762_m3x12", sha256: "aa", byteSize: 10, stepUrl: "https://x/y.step" });
    });
  });

  it("returns [] on a 404 (empty result), not an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 404));
    await expect(searchParts("nonexistent")).resolves.toEqual([]);
  });

  it("throws StepPartsNetworkError on a transport failure (NOT a no-match)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(searchParts("m3")).rejects.toBeInstanceOf(StepPartsNetworkError);
  });

  it("throws StepPartsNetworkError on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(searchParts("m3")).rejects.toBeInstanceOf(StepPartsNetworkError);
  });
});

describe("downloadAndCacheStep", () => {
  const bytes = new TextEncoder().encode("ISO-10303-21; STEP BYTES");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const record: StepPartRecord = {
    id: "iso4762_m3x12",
    sha256,
    byteSize: bytes.byteLength,
    stepUrl: "https://files.step.parts/iso4762_m3x12.step",
  };

  it("downloads, verifies sha256, and caches to R2", async () => {
    fetchMock.mockResolvedValueOnce(bytesResponse(bytes));
    const res = await downloadAndCacheStep(record);
    expect(res.fromCache).toBe(false);
    expect(res.cacheKey).toBe(stepCacheKey(record.id, sha256));
    expect(mockedPutObject).toHaveBeenCalledOnce();
    expect(mockedPutObject.mock.calls[0][0]).toBe(res.cacheKey);
  });

  it("reuses the cached object without re-downloading", async () => {
    mockedObjectExists.mockResolvedValueOnce({ exists: true, sizeBytes: bytes.byteLength });
    const res = await downloadAndCacheStep(record);
    expect(res.fromCache).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedPutObject).not.toHaveBeenCalled();
  });

  it("rejects with a checksum error when the bytes do not match, and does NOT cache", async () => {
    fetchMock.mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("tampered")));
    await expect(downloadAndCacheStep(record)).rejects.toMatchObject({
      name: "StepPartsChecksumError",
    });
    expect(mockedPutObject).not.toHaveBeenCalled();
  });

  it("throws StepPartsNetworkError when the download transport fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(downloadAndCacheStep(record)).rejects.toBeInstanceOf(StepPartsNetworkError);
  });
});
