import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /.well-known/oauth-protected-resource", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("names Clerk as the authorization server and advertises openid + email", async () => {
    const key = `pk_live_${Buffer.from("clerk.materialize.cc$").toString("base64")}`;
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", key);
    const { GET } = await import("../route");
    const res = await GET(
      new Request("https://materialize.cc/.well-known/oauth-protected-resource/api/mcp")
    );
    const body = await res.json();
    expect(body.resource).toBe("https://materialize.cc/api/mcp");
    expect(body.authorization_servers).toEqual(["https://clerk.materialize.cc"]);
    expect(body.scopes_supported).toEqual(expect.arrayContaining(["openid", "email"]));
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("404s without a Clerk key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const { GET } = await import("../route");
    const res = await GET(new Request("https://materialize.cc/.well-known/oauth-protected-resource"));
    expect(res.status).toBe(404);
  });
});
