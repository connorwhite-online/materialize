import { describe, it, expect, vi, beforeEach } from "vitest";
import { setMockUserId } from "@/vitest.setup";

// --- Mocks -----------------------------------------------------------

// Feature gate — the route must 404 (not 403) when it fails, hiding the
// feature's existence exactly like /api/cad/generate and the page.
const mockCanUseTextToCad = vi.fn();
vi.mock("@/lib/features", () => ({
  canUseTextToCad: (...args: unknown[]) => mockCanUseTextToCad(...args),
}));

// Brief builder — best-effort by contract; each test sets its behaviour.
const mockBuildBrief = vi.fn();
vi.mock("@/lib/cad/brief", () => ({
  buildBrief: (...args: unknown[]) => mockBuildBrief(...args),
}));

import { POST } from "../route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/cad/brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SAMPLE_BRIEF = {
  v: 1,
  part: "A ventilated case for a Raspberry Pi 4",
  components: [{ name: "pi-4b", box: [85, 56, 17], clearance: 1 }],
  interfaces: [{ type: "port", std: "usb-c", face: "+X" }],
  keepOut: [],
};

describe("POST /api/cad/brief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockUserId("test-user-id");
    mockCanUseTextToCad.mockReturnValue(true);
    mockBuildBrief.mockResolvedValue(SAMPLE_BRIEF);
  });

  it("returns 401 when unauthenticated", async () => {
    setMockUserId(null);
    const res = await POST(postRequest({ prompt: "a pi case" }));
    expect(res.status).toBe(401);
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("hides the feature behind a 404 when the text-to-CAD gate fails", async () => {
    mockCanUseTextToCad.mockReturnValue(false);
    const res = await POST(postRequest({ prompt: "a pi case" }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-JSON) body with 400", async () => {
    const res = await POST(postRequest("not json"));
    expect(res.status).toBe(400);
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("rejects a too-short prompt with 400 (after trimming)", async () => {
    const res = await POST(postRequest({ prompt: "  a \n" }));
    expect(res.status).toBe(400);
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("rejects a missing prompt with 400", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("rejects a prompt over 2000 chars with 400", async () => {
    const res = await POST(postRequest({ prompt: "x".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mockBuildBrief).not.toHaveBeenCalled();
  });

  it("happy path: trims the prompt, builds the brief, returns { brief }", async () => {
    const res = await POST(postRequest({ prompt: "  a pi case  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: SAMPLE_BRIEF });

    expect(mockBuildBrief).toHaveBeenCalledOnce();
    const arg = mockBuildBrief.mock.calls[0][0];
    expect(arg.prompt).toBe("a pi case");
    // No images attached → none forwarded.
    expect(arg.images).toBeUndefined();
  });

  it("returns 200 { brief: null } when the step can't produce one", async () => {
    // buildBrief is best-effort (no credentials / parse failure) — the
    // client treats null as "brief unavailable, generate directly".
    mockBuildBrief.mockResolvedValue(null);
    const res = await POST(postRequest({ prompt: "a pi case" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: null });
  });

  it("sanitizes images: drops bad media types / shapes, caps at 4", async () => {
    const good = (n: number) => ({
      data: `b64-${n}`,
      mediaType: "image/png",
    });
    const res = await POST(
      postRequest({
        prompt: "a pi case",
        images: [
          { data: "svg", mediaType: "image/svg+xml" }, // disallowed type
          { mediaType: "image/png" }, // no data
          "junk", // not an object
          good(1),
          good(2),
          good(3),
          good(4),
          good(5), // over the cap
        ],
      })
    );
    expect(res.status).toBe(200);
    const arg = mockBuildBrief.mock.calls[0][0];
    expect(arg.images).toEqual([good(1), good(2), good(3), good(4)]);
  });

  it("drops an oversized image instead of failing the request", async () => {
    const oversized = {
      data: "x".repeat(6_500_001),
      mediaType: "image/png",
    };
    const good = { data: "b64", mediaType: "image/jpeg" };
    const res = await POST(
      postRequest({ prompt: "a pi case", images: [oversized, good] })
    );
    expect(res.status).toBe(200);
    const arg = mockBuildBrief.mock.calls[0][0];
    expect(arg.images).toEqual([good]);
  });
});
