import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract test for the three-step upload chain that replaced
// POST /v5/model (removed by CraftCloud, Aug 2026). The shapes
// asserted here are transcribed from craftcloud3d.com's own uploader
// — this chain is NOT in their public spec, so this file is the
// executable record of what we believe it looks like. If uploads
// break again, diff a fresh DevTools capture against these fixtures.

import {
  uploadModelToCraftCloud,
  CraftCloudUploadError,
  CRAFTCLOUD_CUSTOMER_API_BASE,
} from "../model-upload";

const UPLOAD_ID = "400e0295-7d68-42b1-a9ba-b5aab5d210b6";
const UPLOAD_URL = "https://cc-model-uploads-staging-prod.s3.eu-west-1.amazonaws.com/" + UPLOAD_ID;

// Verbatim from the confirm response observed in prod.
const CONFIRM_BODY = [
  {
    sceneId: "ZCXW0bZFURT4r4E",
    area: 2715.4126511625,
    created: "2026-04-12T10:32:34.015Z",
    dimensions: { x: 25, y: 10, z: 54.99702835083008 },
    fileName: "Caribiner.stl",
    fileUnit: "mm",
    updatedAt: "2026-08-06T22:37:32.767Z",
    volume: 1863.2237909415887,
    modelId: "df1011b498f6865ba2710d1dee5ae9f5c210b6e6",
    thumbnailUrl: "https://cc-guest-models-prod.s3.amazonaws.com/thumb.png",
    isParsing: false,
  },
];

function json(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Happy-path fetch stub; per-leg overrides let each test fail one leg. */
function stubChain(overrides: {
  initiate?: Response;
  transfer?: Response;
  confirm?: Response;
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.endsWith("/model/upload/initiate")) {
      return overrides.initiate ?? json({ uploadId: UPLOAD_ID, uploadUrl: UPLOAD_URL });
    }
    if (href.endsWith("/model/upload/confirm")) {
      return overrides.confirm ?? json(CONFIRM_BODY);
    }
    return overrides.transfer ?? new Response("", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function file(): Blob {
  return new Blob(["solid model"], { type: "model/stl" });
}

describe("uploadModelToCraftCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("walks initiate → PUT → confirm in order, against the customer-api host", async () => {
    const { calls } = stubChain();
    await uploadModelToCraftCloud(file(), "Caribiner.stl", "mm");

    expect(calls.map((c) => c.url)).toEqual([
      `${CRAFTCLOUD_CUSTOMER_API_BASE}/model/upload/initiate`,
      UPLOAD_URL,
      `${CRAFTCLOUD_CUSTOMER_API_BASE}/model/upload/confirm`,
    ]);
    // The upload host is NOT api.craftcloud3d.com — that's the dead one.
    expect(calls.some((c) => c.url.includes("api.craftcloud3d.com/v5/model"))).toBe(false);
  });

  it("sends fileName + fileUnit to initiate and the uploadId to confirm", async () => {
    const { calls } = stubChain();
    await uploadModelToCraftCloud(file(), "Caribiner.stl", "in");

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      fileName: "Caribiner.stl",
      fileUnit: "in",
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ uploadId: UPLOAD_ID });
  });

  it("PUTs the bytes to the presigned url with no volunteered headers", async () => {
    const { calls } = stubChain();
    const body = file();
    await uploadModelToCraftCloud(body, "Caribiner.stl");

    expect(calls[1].init?.method).toBe("PUT");
    expect(calls[1].init?.body).toBe(body);
    // A Content-Type we invent can invalidate CraftCloud's signature.
    expect(calls[1].init?.headers).toBeUndefined();
  });

  it("maps the confirm payload onto UploadedModel", async () => {
    stubChain();
    const model = await uploadModelToCraftCloud(file(), "Caribiner.stl", "mm");

    expect(model).toEqual({
      modelId: "df1011b498f6865ba2710d1dee5ae9f5c210b6e6",
      dimensions: { x: 25, y: 10, z: 54.99702835083008 },
      volume: 1863.2237909415887,
      surfaceArea: 2715.4126511625,
      triangleCount: null,
      thumbnailUrl: "https://cc-guest-models-prod.s3.amazonaws.com/thumb.png",
      isParsing: false,
    });
  });

  it("surfaces isParsing when CraftCloud is still meshing", async () => {
    stubChain({ confirm: json([{ ...CONFIRM_BODY[0], isParsing: true }]) });
    const model = await uploadModelToCraftCloud(file(), "Caribiner.stl");
    expect(model.isParsing).toBe(true);
  });

  it.each([
    ["initiate", { initiate: new Response("gone", { status: 404 }) }],
    ["transfer", { transfer: new Response("denied", { status: 403 }) }],
    ["confirm", { confirm: new Response("nope", { status: 500 }) }],
  ] as const)("throws CraftCloudUploadError tagged step=%s", async (step, overrides) => {
    stubChain(overrides);
    const err = await uploadModelToCraftCloud(file(), "Caribiner.stl").catch((e) => e);

    expect(err).toBeInstanceOf(CraftCloudUploadError);
    expect(err.step).toBe(step);
    expect(err.responseBody).toBeTruthy();
    expect(err.message).toBe(`CraftCloud upload failed: ${err.status}`);
  });

  it("treats an initiate response missing uploadUrl as a failure", async () => {
    stubChain({ initiate: json({ uploadId: UPLOAD_ID }) });
    const err = await uploadModelToCraftCloud(file(), "Caribiner.stl").catch((e) => e);
    expect(err).toBeInstanceOf(CraftCloudUploadError);
    expect(err.step).toBe("initiate");
  });

  it("treats an empty confirm array as a failure", async () => {
    stubChain({ confirm: json([]) });
    const err = await uploadModelToCraftCloud(file(), "Caribiner.stl").catch((e) => e);
    expect(err).toBeInstanceOf(CraftCloudUploadError);
    expect(err.step).toBe("confirm");
  });

  it("does not swallow a network-level rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(uploadModelToCraftCloud(file(), "Caribiner.stl")).rejects.toThrow(
      "Failed to fetch"
    );
  });
});
