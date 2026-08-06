import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract test for the browser-direct CraftCloud upload path. Written
// after a prod incident where POST /v5/model returned 404 on every
// upload and Sentry showed nothing: the callers (quote-configurator
// init effect, print-page-content anon draft flow) catch the error and
// render it, so client Sentry never auto-captures. The reporting
// contract here is what makes the next outage visible.

const reportClientErrorImpl = vi.fn();
vi.mock("@/lib/observability/report-client-error", () => ({
  reportClientError: (...args: unknown[]) => reportClientErrorImpl(...args),
}));

import {
  uploadToCraftCloud,
  uploadFileToCraftCloud,
} from "../upload-client";

const MODEL_RESPONSE = [
  {
    modelId: "model-123",
    dimensions: { x: 10, y: 20, z: 30 },
    volume: 42,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFile(name = "carabiner.stl"): File {
  return new File(["solid model"], name, {
    type: "application/octet-stream",
  });
}

describe("uploadFileToCraftCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("happy path: returns the model and reports nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(MODEL_RESPONSE)
    );
    const model = await uploadFileToCraftCloud(makeFile(), "in");
    expect(model).toEqual({
      modelId: "model-123",
      dimensions: { x: 10, y: 20, z: 30 },
      volume: 42,
      triangleCount: null,
    });
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });

  it("reports craftcloud.model-upload-failed with status + body on a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("no such route", { status: 404 })
    );
    await expect(uploadFileToCraftCloud(makeFile(), "mm")).rejects.toThrow(
      "CraftCloud upload failed: 404"
    );
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "craftcloud.model-upload-failed",
      expect.any(Error),
      {
        status: 404,
        filename: "carabiner.stl",
        unit: "mm",
        responseBody: "no such route",
      }
    );
    expect(reportClientErrorImpl).toHaveBeenCalledTimes(1);
  });

  it("truncates the reported response body to 500 chars", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(2000), { status: 502 })
    );
    await expect(uploadFileToCraftCloud(makeFile())).rejects.toThrow(
      "CraftCloud upload failed: 502"
    );
    const extras = reportClientErrorImpl.mock.calls[0][2] as {
      responseBody: string;
    };
    expect(extras.responseBody).toHaveLength(500);
  });

  it("reports craftcloud.model-upload-empty when CraftCloud returns no models", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));
    await expect(uploadFileToCraftCloud(makeFile(), "cm")).rejects.toThrow(
      "CraftCloud returned no models"
    );
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "craftcloud.model-upload-empty",
      expect.any(Error),
      { filename: "carabiner.stl", unit: "cm" }
    );
  });

  it("does NOT report a network-level fetch rejection (noise-floor policy)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );
    await expect(uploadFileToCraftCloud(makeFile())).rejects.toThrow(
      "Failed to fetch"
    );
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });
});

describe("uploadToCraftCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("downloads from the given URL, then uploads and returns the model", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("solid model bytes"))
      .mockResolvedValueOnce(jsonResponse(MODEL_RESPONSE));
    const model = await uploadToCraftCloud(
      "https://r2.example/download-url",
      "bracket.stl",
      "mm"
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://r2.example/download-url"
    );
    expect(model.modelId).toBe("model-123");
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });

  it("reports craftcloud.model-download-failed on a non-OK download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("expired", { status: 403 })
    );
    await expect(
      uploadToCraftCloud("https://r2.example/download-url", "bracket.stl")
    ).rejects.toThrow("Failed to download file");
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "craftcloud.model-download-failed",
      expect.any(Error),
      { status: 403, filename: "bracket.stl" }
    );
    expect(reportClientErrorImpl).toHaveBeenCalledTimes(1);
  });
});
