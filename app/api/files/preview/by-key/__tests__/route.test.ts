/**
 * Tests for GET /api/files/preview/by-key (CON-145).
 *
 * Behavior matrix (verified against route.ts):
 *   - anon → 401
 *   - key missing from query string → 400
 *   - key under another user's prefix → 403
 *   - key under own uploads/${userId}/ prefix → 200
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUserId: string | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mockUserId }),
}));

vi.mock("@/lib/storage", () => ({
  generateDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed"),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GET } from "../route";

function makeRequest(key: string | null) {
  const base = "http://localhost/api/files/preview/by-key";
  const url = key !== null ? `${base}?key=${encodeURIComponent(key)}` : base;
  return new Request(url);
}

function upstreamOk() {
  const body = new ReadableStream();
  mockFetch.mockResolvedValue(
    new Response(body, { status: 200, headers: {} })
  );
}

beforeEach(() => {
  mockUserId = null;
  mockFetch.mockReset();
});

describe("preview/by-key GET", () => {
  it("anon gets 401", async () => {
    mockUserId = null;
    const res = await GET(makeRequest("uploads/user-me/abc/file.stl"));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("missing key query param gets 400", async () => {
    mockUserId = "user-me";
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("key under another user's prefix gets 403 (prefix escape)", async () => {
    mockUserId = "user-me";
    const res = await GET(
      makeRequest("uploads/other-user/nanoid/model.stl")
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("key under own uploads/${userId}/ prefix gets 200", async () => {
    mockUserId = "user-me";
    upstreamOk();

    const res = await GET(
      makeRequest("uploads/user-me/nanoid123/model.stl")
    );
    expect(res.status).toBe(200);
  });
});
