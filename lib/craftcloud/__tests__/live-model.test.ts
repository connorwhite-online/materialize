import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * SEC-26 — the CraftCloud client test suite was 100% mock-mode
 * (client.test.ts forces CRAFTCLOUD_USE_MOCK=true), so the live
 * `realUploadModel` / `realGetModel` implementations had zero
 * coverage. That's how `realGetModel` shipped without a `res.ok`
 * check — a 500 response was silently parsed and returned as if the
 * model were `ready`. This file exercises the live path the same way
 * api-request-retry.test.ts does: force live mode, stub global
 * fetch, reset modules so the module-level USE_MOCK flag is
 * re-evaluated against the stubbed env.
 */

vi.stubEnv("CRAFTCLOUD_USE_MOCK", "false");
vi.stubEnv("CRAFTCLOUD_MOCK_CHECKOUT", "false");

const fetchMock = vi.fn();
const originalFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

type ClientModule = typeof import("../client");
let uploadModel: ClientModule["uploadModel"];
let getModel: ClientModule["getModel"];
let CraftCloudApiError: ClientModule["CraftCloudApiError"];

beforeAll(async () => {
  vi.resetModules();
  const mod = await import("../client");
  ({ uploadModel, getModel, CraftCloudApiError } = mod);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe("realUploadModel (live mode)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns models[0] on a successful upload", async () => {
    const mockModel = { id: "model-123", filename: "part.stl", fileUnit: "mm" };
    fetchMock.mockResolvedValueOnce(jsonResponse([mockModel]));

    const result = await uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm");

    expect(result).toEqual(mockModel);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when CraftCloud returns an empty array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await expect(
      uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm")
    ).rejects.toThrow(/no models/i);
  });

  it("throws on a non-2xx upload response", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("bad request", 400));

    await expect(
      uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm")
    ).rejects.toThrow(/Upload failed/i);
  });
});

describe("realGetModel (live mode)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("206 response → parsing: true, status: 'parsing'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "model-123", filename: "part.stl" }, 206)
    );

    const model = await getModel("model-123");

    expect(model.parsing).toBe(true);
    expect(model.status).toBe("parsing");
  });

  it("200 response → parsing: false, status: 'ready'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "model-123", filename: "part.stl" }, 200)
    );

    const model = await getModel("model-123");

    expect(model.parsing).toBe(false);
    expect(model.status).toBe("ready");
  });

  it("500 response → throws CraftCloudApiError (SEC-26 fix — previously parsed as ready)", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("internal error", 500));

    await expect(getModel("model-123")).rejects.toBeInstanceOf(CraftCloudApiError);
  });

  it("404 response → throws CraftCloudApiError", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("not found", 404));

    await expect(getModel("does-not-exist")).rejects.toBeInstanceOf(
      CraftCloudApiError
    );
  });
});
