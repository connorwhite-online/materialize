/**
 * GET /api/widget/model/[fileAssetId] — token-gated model bytes for the
 * MCP quote widget. Pins that a paid listing's original only leaves with
 * a `full` token; every other token gets the low-detail copy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let assetRow: Record<string, unknown> | null = null;

vi.mock("@/lib/db/schema", () => ({
  fileAssets: { id: "id", fileId: "fileId", storageKey: "storageKey", format: "format" },
  files: { id: "id", price: "price" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(assetRow ? [assetRow] : []),
          }),
        }),
      }),
    }),
  },
}));

const mockGetObjectBytes = vi.fn();
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (...args: unknown[]) => mockGetObjectBytes(...args),
}));

const mockGetPreviewBytes = vi.fn();
vi.mock("@/lib/files/model-preview", () => ({
  getPreviewBytes: (...args: unknown[]) => mockGetPreviewBytes(...args),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET } from "../route";
import { mintWidgetModelToken } from "@/lib/mcp/widgets/model-token";

const ORIGINAL = new Uint8Array([1, 1, 1]);
const PREVIEW = new Uint8Array([2, 2]);

function call(token: string | null, id = "asset-1") {
  const url = `http://localhost/api/widget/model/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return GET(new Request(url), { params: Promise.resolve({ fileAssetId: id }) });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_widget";
  assetRow = { storageKey: "uploads/u/m.stl", format: "stl", filePrice: 0 };
  mockGetObjectBytes.mockReset();
  mockGetObjectBytes.mockResolvedValue(ORIGINAL);
  mockGetPreviewBytes.mockReset();
  mockGetPreviewBytes.mockResolvedValue(PREVIEW);
});

describe("widget/model GET", () => {
  it("rejects a missing or foreign token", async () => {
    expect((await call(null)).status).toBe(403);
    expect((await call(mintWidgetModelToken("asset-2"))).status).toBe(403);
  });

  it("free listing: the original, whatever the variant", async () => {
    const res = await call(mintWidgetModelToken("asset-1", Date.now(), "preview"));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ORIGINAL);
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
  });

  it("paid listing + preview token: the low-detail copy, never the original", async () => {
    assetRow = { ...assetRow!, filePrice: 900 };
    const res = await call(mintWidgetModelToken("asset-1"));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PREVIEW);
    expect(res.headers.get("Content-Type")).toBe("model/stl");
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });

  it("paid listing + full token (entitled caller): the original", async () => {
    assetRow = { ...assetRow!, filePrice: 900 };
    const res = await call(mintWidgetModelToken("asset-1", Date.now(), "full"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ORIGINAL);
    expect(mockGetPreviewBytes).not.toHaveBeenCalled();
  });

  it("paid listing that can't be decimated: 415, never the original", async () => {
    assetRow = { ...assetRow!, filePrice: 900 };
    mockGetPreviewBytes.mockResolvedValue(null);
    const res = await call(mintWidgetModelToken("asset-1"));
    expect(res.status).toBe(415);
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });

  it("STEP/AMF: 415", async () => {
    assetRow = { ...assetRow!, format: "step" };
    expect((await call(mintWidgetModelToken("asset-1"))).status).toBe(415);
  });
});
