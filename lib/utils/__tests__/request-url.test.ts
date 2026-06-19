import { describe, it, expect, vi, beforeEach } from "vitest";

// next/headers is pre-mocked in vitest.setup.ts with a default null-returning
// headers() stub. Each test overrides it for the specific header combination
// under test.
import { headers } from "next/headers";

import { deriveAppUrl } from "../request-url";

const mockHeaders = vi.mocked(headers);

describe("deriveAppUrl", () => {
  beforeEach(() => {
    // Clear any NEXT_PUBLIC_APP_URL that leaked from environment
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("returns proto + x-forwarded-host when both are present", async () => {
    mockHeaders.mockResolvedValueOnce({
      get: (name: string) => {
        if (name === "x-forwarded-host") return "example.com";
        if (name === "x-forwarded-proto") return "https";
        return null;
      },
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const url = await deriveAppUrl();
    expect(url).toBe("https://example.com");
  });

  it("defaults proto to https when only host is present (no x-forwarded-proto)", async () => {
    mockHeaders.mockResolvedValueOnce({
      get: (name: string) => {
        if (name === "host") return "myapp.com";
        return null;
      },
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const url = await deriveAppUrl();
    expect(url).toBe("https://myapp.com");
  });

  it("prefers x-forwarded-host over host when both present", async () => {
    mockHeaders.mockResolvedValueOnce({
      get: (name: string) => {
        if (name === "x-forwarded-host") return "forwarded.example.com";
        if (name === "host") return "direct.example.com";
        if (name === "x-forwarded-proto") return "https";
        return null;
      },
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const url = await deriveAppUrl();
    expect(url).toBe("https://forwarded.example.com");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when no host headers are present", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://env-app.example.com";

    mockHeaders.mockResolvedValueOnce({
      get: (_name: string) => null,
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const url = await deriveAppUrl();
    expect(url).toBe("https://env-app.example.com");
  });

  it("falls back to http://localhost:3000 when no host headers and no env var", async () => {
    mockHeaders.mockResolvedValueOnce({
      get: (_name: string) => null,
    } as unknown as Awaited<ReturnType<typeof headers>>);

    const url = await deriveAppUrl();
    expect(url).toBe("http://localhost:3000");
  });
});
