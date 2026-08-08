import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract test for the browser upload path. Written after a prod
// incident where uploads returned 404 on every attempt and Sentry
// showed nothing: the callers (quote-configurator init effect,
// print-page-content anon draft flow) catch the error and render it,
// so client Sentry never auto-captures. The reporting contract here is
// what makes the next outage visible.
//
// The chain itself (initiate → PUT → confirm) is covered in
// model-upload.test.ts; this file only pins the telemetry wrapper.

const reportClientErrorImpl = vi.fn();
vi.mock("@/lib/observability/report-client-error", () => ({
  reportClientError: (...args: unknown[]) => reportClientErrorImpl(...args),
}));

const uploadModelToCraftCloudMock = vi.fn();
vi.mock("../model-upload", async () => {
  const actual = await vi.importActual<typeof import("../model-upload")>(
    "../model-upload"
  );
  return {
    ...actual,
    uploadModelToCraftCloud: (...args: unknown[]) =>
      uploadModelToCraftCloudMock(...args),
  };
});

import { uploadToCraftCloud, uploadFileToCraftCloud } from "../upload-client";
import { CraftCloudUploadError } from "../model-upload";

const MODEL = {
  modelId: "model-123",
  dimensions: { x: 10, y: 20, z: 30 },
  volume: 42,
  surfaceArea: 100,
  triangleCount: null,
  thumbnailUrl: null,
  isParsing: false,
};

function makeFile(name = "carabiner.stl"): File {
  return new File(["solid model"], name, {
    type: "application/octet-stream",
  });
}

describe("uploadFileToCraftCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    uploadModelToCraftCloudMock.mockResolvedValue(MODEL);
  });

  it("happy path: returns the model and reports nothing", async () => {
    const f = makeFile();
    const model = await uploadFileToCraftCloud(f, "in");

    expect(model).toEqual(MODEL);
    expect(uploadModelToCraftCloudMock).toHaveBeenCalledWith(
      f,
      "carabiner.stl",
      "in"
    );
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });

  it("reports craftcloud.model-upload-failed with the failing step + body", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
      new CraftCloudUploadError("initiate", 404, "no such route")
    );

    await expect(uploadFileToCraftCloud(makeFile(), "mm")).rejects.toThrow(
      "CraftCloud upload failed: 404"
    );
    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "craftcloud.model-upload-failed",
      expect.any(CraftCloudUploadError),
      {
        step: "initiate",
        status: 404,
        filename: "carabiner.stl",
        unit: "mm",
        responseBody: "no such route",
      }
    );
    expect(reportClientErrorImpl).toHaveBeenCalledTimes(1);
  });

  it("truncates the reported response body to 500 chars", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
      new CraftCloudUploadError("confirm", 502, "x".repeat(2000))
    );

    await expect(uploadFileToCraftCloud(makeFile())).rejects.toThrow();
    const extras = reportClientErrorImpl.mock.calls[0][2] as {
      responseBody: string;
    };
    expect(extras.responseBody).toHaveLength(500);
  });

  it("does NOT report a network-level rejection (noise-floor policy)", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
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
    vi.unstubAllGlobals();
    uploadModelToCraftCloudMock.mockResolvedValue(MODEL);
  });

  it("downloads from the given URL, then uploads the blob", async () => {
    const fetchMock = vi.fn(async () => new Response("solid model bytes"));
    vi.stubGlobal("fetch", fetchMock);

    const model = await uploadToCraftCloud(
      "/api/files/preview/asset-1",
      "bracket.stl",
      "mm"
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/files/preview/asset-1");
    expect(model.modelId).toBe("model-123");
    expect(uploadModelToCraftCloudMock).toHaveBeenCalledWith(
      expect.any(Blob),
      "bracket.stl",
      "mm"
    );
    expect(reportClientErrorImpl).not.toHaveBeenCalled();
  });

  it("reports craftcloud.model-download-failed on a non-OK download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("expired", { status: 403 }))
    );

    await expect(
      uploadToCraftCloud("/api/files/preview/asset-1", "bracket.stl")
    ).rejects.toThrow("Failed to download file");

    expect(reportClientErrorImpl).toHaveBeenCalledWith(
      "craftcloud.model-download-failed",
      expect.any(Error),
      { status: 403, filename: "bracket.stl" }
    );
    expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
  });
});
