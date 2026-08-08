/**
 * Tests for POST /api/craftcloud/upload-model.
 *
 * This route exists because CraftCloud's replacement upload endpoints
 * only allow https://craftcloud3d.com as an origin — the browser
 * cannot call them (confirmed in prod as
 * craftcloud.model-upload-unreachable at the initiate leg). The chain
 * runs here instead, so the access gate and the persistence rules
 * that used to live in download-url + cache-model now both apply in
 * one place.
 *
 * Access matrix mirrors download-url/cache-model:
 *   published file → anyone including anon → 200
 *   draft file + owner → 200
 *   draft file + other user / anon → 403
 *   missing row → 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;
let assetRow: Record<string, unknown> | null = null;
const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn();
let updateShouldThrow = false;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/db/schema", () => ({
  fileAssets: {
    id: "id",
    fileId: "file_id",
    storageKey: "storage_key",
    originalFilename: "original_filename",
    fileUnit: "file_unit",
    craftCloudModelId: "craft_cloud_model_id",
  },
  files: { id: "id", userId: "user_id", status: "status" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(assetRow ? [assetRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSetSpy(values);
        return {
          where: async (clause: unknown) => {
            updateWhereSpy(clause);
            if (updateShouldThrow) throw new Error("db down");
          },
        };
      },
    }),
  },
}));

const getObjectBytesMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (...args: unknown[]) => getObjectBytesMock(...args),
}));

const consumeAnonUploadGrantMock = vi.fn();
vi.mock("@/lib/uploads/anon-grants", () => ({
  consumeAnonUploadGrant: (...a: unknown[]) =>
    consumeAnonUploadGrantMock(...a),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const uploadModelToCraftCloudMock = vi.fn();
vi.mock("@/lib/craftcloud/model-upload", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/craftcloud/model-upload")
  >("@/lib/craftcloud/model-upload");
  return {
    ...actual,
    uploadModelToCraftCloud: (...args: unknown[]) =>
      uploadModelToCraftCloudMock(...args),
  };
});

import { POST } from "../route";
import { CraftCloudUploadError } from "@/lib/craftcloud/model-upload";

const MODEL = {
  modelId: "model-123",
  dimensions: { x: 25, y: 10, z: 55 },
  volume: 1863,
  surfaceArea: 2715,
  triangleCount: null,
  thumbnailUrl: null,
  isParsing: false,
};

function req(body: unknown = { fileAssetId: "asset-1" }) {
  return new Request("http://localhost/api/craftcloud/upload-model", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function publishedAsset(overrides: Record<string, unknown> = {}) {
  return {
    storageKey: "uploads/u1/abc/part.stl",
    filename: "part.stl",
    fileUnit: "cm",
    cachedModelId: null,
    fileUserId: "u1",
    fileStatus: "published",
    ...overrides,
  };
}

describe("POST /api/craftcloud/upload-model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserId = null;
    assetRow = publishedAsset();
    updateShouldThrow = false;
    getObjectBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    uploadModelToCraftCloudMock.mockResolvedValue(MODEL);
    consumeAnonUploadGrantMock.mockResolvedValue({
      originalFilename: "part.stl",
    });
  });

  it("uploads from R2 with the asset's filename + unit and returns the model", async () => {
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      modelId: "model-123",
      dimensions: { x: 25, y: 10, z: 55 },
      volume: 1863,
      isParsing: false,
    });
    expect(getObjectBytesMock).toHaveBeenCalledWith("uploads/u1/abc/part.stl");
    expect(uploadModelToCraftCloudMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "part.stl",
      "cm"
    );
  });

  it("persists the modelId and geometry", async () => {
    await POST(req());

    expect(updateSetSpy).toHaveBeenCalledWith({
      craftCloudModelId: "model-123",
      geometryData: { dimensions: { x: 25, y: 10, z: 55 }, volume: 1863 },
    });
  });

  it("omits geometryData when CraftCloud returned no dimensions", async () => {
    uploadModelToCraftCloudMock.mockResolvedValue({
      ...MODEL,
      dimensions: null,
    });

    await POST(req());

    expect(updateSetSpy).toHaveBeenCalledWith({ craftCloudModelId: "model-123" });
  });

  // The caller already has the modelId from the response body and
  // quotes fine without the row ever being written; a failed cache
  // only costs a re-upload next visit. Matches the resilience the
  // client-side cache-model call used to have.
  it("still succeeds when the cache write fails", async () => {
    updateShouldThrow = true;

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect((await res.json()).modelId).toBe("model-123");
    expect(logErrorMock).toHaveBeenCalledWith(
      "api/craftcloud/upload-model:cache",
      expect.any(Error)
    );
  });

  it("maps a CraftCloud failure to 502 carrying the failing step", async () => {
    uploadModelToCraftCloudMock.mockRejectedValue(
      new CraftCloudUploadError("initiate", 404, "gone")
    );

    const res = await POST(req());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "CraftCloud upload failed: 404",
      step: "initiate",
      craftCloudStatus: 404,
    });
  });

  it("returns 500 for an unexpected failure without leaking detail", async () => {
    getObjectBytesMock.mockRejectedValue(new Error("R2 exploded"));

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to upload model" });
  });

  it("400s without a fileAssetId or storageKey", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
  });

  // Anon draft mode: no fileAssets row exists. The grant IS the
  // authorization — see lib/uploads/anon-grants.ts.
  describe("anon storageKey mode", () => {
    const anonKey = "anon-uploads/abc123/part.stl";

    it("redeems the grant and uploads the staged object", async () => {
      const res = await POST(req({ storageKey: anonKey, fileUnit: "in" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        modelId: "model-123",
        dimensions: { x: 25, y: 10, z: 55 },
        volume: 1863,
        isParsing: false,
      });
      expect(consumeAnonUploadGrantMock).toHaveBeenCalledWith(anonKey);
      expect(getObjectBytesMock).toHaveBeenCalledWith(anonKey);
      // Filename comes from the GRANT, not from caller-supplied input.
      expect(uploadModelToCraftCloudMock).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "part.stl",
        "in"
      );
    });

    it("defaults the unit to mm", async () => {
      await POST(req({ storageKey: anonKey }));
      expect(uploadModelToCraftCloudMock).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "part.stl",
        "mm"
      );
    });

    // Consumed, expired, or never issued — all indistinguishable, and
    // none of them may reach R2.
    it("403s and never reads storage when the grant is not redeemable", async () => {
      consumeAnonUploadGrantMock.mockResolvedValue(null);

      const res = await POST(req({ storageKey: anonKey }));

      expect(res.status).toBe(403);
      expect(getObjectBytesMock).not.toHaveBeenCalled();
      expect(uploadModelToCraftCloudMock).not.toHaveBeenCalled();
    });

    // The guard that stops this becoming an arbitrary-object reader:
    // an un-granted key is refused no matter what it points at.
    it("403s on a key outside the anon prefix", async () => {
      consumeAnonUploadGrantMock.mockResolvedValue(null);

      const res = await POST(req({ storageKey: "uploads/u1/secret/part.stl" }));

      expect(res.status).toBe(403);
      expect(getObjectBytesMock).not.toHaveBeenCalled();
    });

    it("writes nothing to the DB — there is no fileAssets row yet", async () => {
      await POST(req({ storageKey: anonKey }));
      expect(updateSetSpy).not.toHaveBeenCalled();
    });

    it("takes precedence over a fileAssetId sent alongside it", async () => {
      await POST(req({ storageKey: anonKey, fileAssetId: "asset-1" }));
      expect(getObjectBytesMock).toHaveBeenCalledWith(anonKey);
      expect(getObjectBytesMock).not.toHaveBeenCalledWith(
        "uploads/u1/abc/part.stl"
      );
    });
  });

  it("404s when the asset row is missing", async () => {
    assetRow = null;
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(getObjectBytesMock).not.toHaveBeenCalled();
  });

  describe("access gate", () => {
    it("allows anon on a published file", async () => {
      mockUserId = null;
      assetRow = publishedAsset();
      expect((await POST(req())).status).toBe(200);
    });

    it("allows the owner on a draft file", async () => {
      mockUserId = "u1";
      assetRow = publishedAsset({ fileStatus: "draft" });
      expect((await POST(req())).status).toBe(200);
    });

    it("403s anon on a draft file", async () => {
      mockUserId = null;
      assetRow = publishedAsset({ fileStatus: "draft" });
      const res = await POST(req());
      expect(res.status).toBe(403);
      expect(getObjectBytesMock).not.toHaveBeenCalled();
    });

    it("403s a different user on a draft file", async () => {
      mockUserId = "u2";
      assetRow = publishedAsset({ fileStatus: "draft" });
      expect((await POST(req())).status).toBe(403);
    });

    // A non-owner quoting a published listing may first-capture the
    // modelId but must never repoint an established one at different
    // geometry — enforced by an isNull clause in the where().
    it("guards the update with isNull for a non-owner", async () => {
      mockUserId = "u2";
      assetRow = publishedAsset();

      await POST(req());

      expect(updateWhereSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(updateWhereSpy.mock.calls[0][0])).toContain(
        "craft_cloud_model_id"
      );
    });
  });
});
