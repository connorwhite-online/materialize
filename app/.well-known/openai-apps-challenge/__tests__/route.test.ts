import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

describe("GET /.well-known/openai-apps-challenge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves exactly the token as plain text", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE_TOKEN", "  tok_abc123\n");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("tok_abc123");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("404s when no token is configured", () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE_TOKEN", "");
    expect(GET().status).toBe(404);
  });
});
