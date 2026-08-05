/**
 * Tests for POST /api/cad/feature-preview (docs/text-to-cad/10).
 *
 * The derivation itself is covered in lib/cad/__tests__/features.test.ts
 * (deriveParamRerunSource) — here we pin the route contract: auth/gating,
 * owner-only row access, 422 on underivable or unbuildable drafts, and the
 * raw STL byte response on success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;
let parentRow: Record<string, unknown> | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
  currentUser: async () => ({ emailAddresses: [] }),
}));

const mockCanUse = vi.fn(() => true);
vi.mock("@/lib/features", () => ({
  canUseTextToCad: () => mockCanUse(),
}));
vi.mock("@/lib/clerk-email", () => ({
  primaryEmail: () => "user@example.com",
}));

const mockRate = vi.fn();
vi.mock("@/app/api/cad/generate/rate-limit", () => ({
  checkCadGenerateRateLimit: (...args: unknown[]) => mockRate(...args),
}));

vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    id: "id",
    userId: "userId",
    sourceCode: "sourceCode",
    status: "status",
    engine: "engine",
    features: "features",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(parentRow ? [parentRow] : []),
        }),
      }),
    }),
  },
}));

const mockRunCadCode = vi.fn();
vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: unknown[]) => mockRunCadCode(...args),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { POST } from "../route";

const SOURCE = ["wall = 2.4", "result = make(wall)"].join("\n");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/cad/feature-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function succeededParent() {
  return {
    sourceCode: SOURCE,
    status: "succeeded",
    engine: "build123d",
    features: null,
  };
}

beforeEach(() => {
  mockUserId = null;
  parentRow = null;
  mockCanUse.mockReturnValue(true);
  mockRate.mockResolvedValue({ ok: true });
  mockRunCadCode.mockReset();
});

describe("POST /api/cad/feature-preview", () => {
  it("401s anon", async () => {
    const res = await POST(makeRequest({ generationId: "g1", params: {} }));
    expect(res.status).toBe(401);
  });

  it("429s when the generate rate limit trips", async () => {
    mockUserId = "u1";
    mockRate.mockResolvedValue({ ok: false, count: 40, windowMinutes: 10 });
    const res = await POST(
      makeRequest({ generationId: "g1", params: { wall: 3 } })
    );
    expect(res.status).toBe(429);
  });

  it("404s a missing / non-owned / unsucceeded generation", async () => {
    mockUserId = "u1";
    parentRow = null;
    let res = await POST(
      makeRequest({ generationId: "g1", params: { wall: 3 } })
    );
    expect(res.status).toBe(404);

    parentRow = { ...succeededParent(), status: "pending" };
    res = await POST(makeRequest({ generationId: "g1", params: { wall: 3 } }));
    expect(res.status).toBe(404);
  });

  it("422s a draft with nothing applicable", async () => {
    mockUserId = "u1";
    parentRow = succeededParent();
    const res = await POST(
      makeRequest({ generationId: "g1", params: { injected: 99 } })
    );
    expect(res.status).toBe(422);
    expect(mockRunCadCode).not.toHaveBeenCalled();
  });

  it("streams STL bytes for a buildable draft (STL-only formats)", async () => {
    mockUserId = "u1";
    parentRow = succeededParent();
    const stl = Buffer.from("solid preview").toString("base64");
    mockRunCadCode.mockResolvedValue({ ok: true, files: { stl } });

    const res = await POST(
      makeRequest({ generationId: "g1", params: { wall: 3.2 } })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("model/stl");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(
      "solid preview"
    );
    // The rewritten source (not the original) went to the sidecar, STL only.
    const [code, formats] = mockRunCadCode.mock.calls[0];
    expect(code).toContain("wall = 3.2");
    expect(formats).toEqual(["stl"]);
  });

  it("422s with the kernel error when the draft can't be built", async () => {
    mockUserId = "u1";
    parentRow = succeededParent();
    mockRunCadCode.mockResolvedValue({
      ok: false,
      files: {},
      error: "fillet radius too large",
    });

    const res = await POST(
      makeRequest({ generationId: "g1", params: { wall: 99 } })
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("fillet radius too large");
  });
});
