import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Hourly synthetic upload against the live CraftCloud chain.
 *
 * The properties that matter: it actually reaches CraftCloud (a
 * canary that silently runs against mocks is worse than none), a
 * failure is reported loudly enough for Sentry to page on, and the
 * failing leg is named in that report — the difference between
 * "CraftCloud is down" and "they changed the contract again".
 */

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...a: unknown[]) => logErrorMock(...a),
}));

const uploadModelToCraftCloudMock = vi.fn();
vi.mock("@/lib/craftcloud/model-upload", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/craftcloud/model-upload")
  >("@/lib/craftcloud/model-upload");
  return {
    ...actual,
    uploadModelToCraftCloud: (...a: unknown[]) =>
      uploadModelToCraftCloudMock(...a),
  };
});

import { GET } from "../route";
import { CraftCloudUploadError } from "@/lib/craftcloud/model-upload";
import { CANARY_FILENAME } from "@/lib/craftcloud/canary-solid";

const MODEL = {
  modelId: "canary-model-1",
  dimensions: { x: 10, y: 8.66, z: 8.165 },
  volume: 118,
  surfaceArea: 200,
  triangleCount: null,
  thumbnailUrl: null,
  isParsing: false,
};

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/craftcloud-upload-canary", {
    headers,
  });
}

const originalSecret = process.env.CRON_SECRET;
const originalMock = process.env.CRAFTCLOUD_USE_MOCK;

describe("cron/craftcloud-upload-canary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    // Live mode — the only mode in which the canary asserts anything.
    process.env.CRAFTCLOUD_USE_MOCK = "false";
    uploadModelToCraftCloudMock.mockResolvedValue(MODEL);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    if (originalMock === undefined) delete process.env.CRAFTCLOUD_USE_MOCK;
    else process.env.CRAFTCLOUD_USE_MOCK = originalMock;
  });

  it("uploads the synthetic solid and reports success", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.modelId).toBe("canary-model-1");
    expect(body.hasDimensions).toBe(true);
    expect(typeof body.durationMs).toBe("number");

    const [bytes, filename, unit] = uploadModelToCraftCloudMock.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(284);
    expect(filename).toBe(CANARY_FILENAME);
    expect(unit).toBe("mm");
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  // A parse regression on CraftCloud's side could return a model with
  // no geometry while still "succeeding" — visible in the cron log
  // rather than silently green.
  it("surfaces a model that came back without dimensions", async () => {
    uploadModelToCraftCloudMock.mockResolvedValue({
      ...MODEL,
      dimensions: null,
    });

    const body = await (await GET(makeRequest("Bearer test-secret"))).json();

    expect(body.ok).toBe(true);
    expect(body.hasDimensions).toBe(false);
  });

  it("reports the failing leg to Sentry and 502s", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
      new CraftCloudUploadError("initiate", 404, "no such route")
    );

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toMatchObject({ ok: false, step: "initiate", status: 404 });
    expect(logErrorMock).toHaveBeenCalledWith(
      "cron/craftcloud-upload-canary",
      expect.objectContaining({
        step: "initiate",
        status: 404,
        responseBody: "no such route",
        // The step is in the message so the Sentry issue title itself
        // names which leg died.
        message: expect.stringContaining("initiate"),
      })
    );
  });

  it("reports a CORS/network failure with its status-0 sentinel", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
      new CraftCloudUploadError("initiate", 0, "Failed to fetch")
    );

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe(0);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("500s and logs on an unexpected error", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(new Error("boom"));

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
    expect(logErrorMock).toHaveBeenCalledWith(
      "cron/craftcloud-upload-canary",
      expect.any(Error)
    );
  });

  // Mock mode is the default. A "green" canary run that never touched
  // CraftCloud would be a lie, so it skips explicitly instead.
  it("skips without calling CraftCloud when mock mode is on", async () => {
    process.env.CRAFTCLOUD_USE_MOCK = "true";

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(body.ok).toBeUndefined();
    expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
  });

  it("skips when CRAFTCLOUD_USE_MOCK is unset (mock is the default)", async () => {
    delete process.env.CRAFTCLOUD_USE_MOCK;

    const body = await (await GET(makeRequest("Bearer test-secret"))).json();

    expect(body.skipped).toBe(true);
    expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
  });

  describe("auth", () => {
    it("401s without an Authorization header", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
    });

    it("401s with the wrong token", async () => {
      const res = await GET(makeRequest("Bearer wrong"));
      expect(res.status).toBe(401);
      expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
    });

    it("500s fail-closed when CRON_SECRET is unset", async () => {
      delete process.env.CRON_SECRET;
      const res = await GET(makeRequest("Bearer anything"));
      expect(res.status).toBe(500);
      expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
    });
  });
});
