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

// Server-side upload now runs the same initiate → PUT → confirm chain
// as the browser (model-upload.ts) — /v5/model was removed by
// CraftCloud. This path is what MCP agent uploads go through
// (lib/mcp/internal/files.ts), so it is the one that must keep
// producing a CraftCloudModel with the legacy field names.
describe("realUploadModel (live mode)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  function stubHappyChain() {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ uploadId: "upload-1", uploadUrl: "https://s3.test/upload-1" }, 201)
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              modelId: "model-123",
              dimensions: { x: 25, y: 10, z: 55 },
              volume: 1863,
              area: 2715,
              isParsing: false,
            },
          ],
          201
        )
      );
  }

  it("maps the confirm payload onto CraftCloudModel", async () => {
    stubHappyChain();

    const result = await uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm");

    expect(result).toEqual({
      id: "model-123",
      filename: "part.stl",
      fileUnit: "mm",
      geometry: {
        dimensions: { x: 25, y: 10, z: 55 },
        volume: 1863,
        surfaceArea: 2715,
        // confirm carries no triangle count.
        triangleCount: 0,
      },
      status: "ready",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports status 'parsing' when CraftCloud is still meshing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ uploadId: "upload-1", uploadUrl: "https://s3.test/upload-1" }, 201)
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse([{ modelId: "model-123", isParsing: true }], 201)
      );

    const result = await uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm");
    expect(result.status).toBe("parsing");
    expect(result.geometry).toBeNull();
  });

  it("throws when confirm returns an empty array", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ uploadId: "upload-1", uploadUrl: "https://s3.test/upload-1" }, 201)
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse([], 201));

    await expect(
      uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm")
    ).rejects.toThrow(/upload failed/i);
  });

  it("throws on a non-2xx initiate response, without attempting the transfer", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("bad request", 400));

    await expect(
      uploadModel(new Uint8Array([1, 2, 3]), "part.stl", "mm")
    ).rejects.toThrow(/upload failed: 400/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
