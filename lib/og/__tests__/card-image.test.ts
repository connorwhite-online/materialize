import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveImageUrl, shouldFullBleed } from "../card-image";

const mockHeaders = vi.hoisted(() => ({ current: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeaders.current.get(name) ?? null,
    }),
}));

beforeEach(() => {
  mockHeaders.current = new Map([
    ["x-forwarded-host", "materialize.cc"],
    ["x-forwarded-proto", "https"],
  ]);
});

describe("resolveImageUrl", () => {
  it("resolves a relative thumbnail path against the live request host", async () => {
    // The regression this exists for: files.thumbnailUrl is stored as
    // `/api/thumbnails/{id}`, and Node's fetch rejects relative URLs,
    // so every file OG card rendered its no-image placeholder.
    await expect(resolveImageUrl("/api/thumbnails/file_123")).resolves.toBe(
      "https://materialize.cc/api/thumbnails/file_123"
    );
  });

  it("tracks the forwarded host rather than a baked-in app URL", async () => {
    mockHeaders.current.set("x-forwarded-host", "preview-abc.vercel.app");
    await expect(resolveImageUrl("/api/thumbnails/file_123")).resolves.toBe(
      "https://preview-abc.vercel.app/api/thumbnails/file_123"
    );
  });

  it("honours a forwarded http proto", async () => {
    mockHeaders.current.set("x-forwarded-host", "localhost:3000");
    mockHeaders.current.set("x-forwarded-proto", "http");
    await expect(resolveImageUrl("/api/thumbnails/x")).resolves.toBe(
      "http://localhost:3000/api/thumbnails/x"
    );
  });

  it("passes absolute URLs through untouched", async () => {
    const cloudinary =
      "https://res.cloudinary.com/all3dp/image/upload/w_1200/foo.jpg";
    await expect(resolveImageUrl(cloudinary)).resolves.toBe(cloudinary);
  });

  it("passes data URLs through untouched", async () => {
    await expect(resolveImageUrl("data:image/webp;base64,AAAA")).resolves.toBe(
      "data:image/webp;base64,AAAA"
    );
  });

  it("returns null for an empty reference", async () => {
    await expect(resolveImageUrl("")).resolves.toBeNull();
  });

  it("returns null for a reference with no defensible resolution", async () => {
    // A bare storage key is not a path we can serve, and a
    // protocol-relative or javascript: URL has no business being
    // fetched. All render the no-image card instead.
    await expect(resolveImageUrl("thumbnails/file_123.webp")).resolves.toBeNull();
    await expect(resolveImageUrl("//evil.example/x.png")).resolves.toBeNull();
    await expect(
      resolveImageUrl("javascript:alert(1)")
    ).resolves.toBeNull();
  });
});

describe("shouldFullBleed", () => {
  it("goes full-bleed when a full layout has artwork", () => {
    expect(shouldFullBleed("full", true)).toBe(true);
  });

  it("falls back to the split card when a full layout has no artwork", () => {
    // Otherwise the card is a flat rectangle with nothing naming the link.
    expect(shouldFullBleed("full", false)).toBe(false);
  });

  it("leaves the split layout alone", () => {
    expect(shouldFullBleed("split", true)).toBe(false);
    expect(shouldFullBleed(undefined, true)).toBe(false);
  });
});
