import { describe, it, expect } from "vitest";
import { isSessionGatedImageSrc } from "../session-gated-src";

describe("isSessionGatedImageSrc", () => {
  it("matches file and project thumbnail proxy paths", () => {
    expect(isSessionGatedImageSrc("/api/thumbnails/f1")).toBe(true);
    expect(
      isSessionGatedImageSrc("/api/thumbnails/f1?photoId=p1&v=abc")
    ).toBe(true);
    expect(isSessionGatedImageSrc("/api/thumbnails/projects/p1")).toBe(true);
    expect(
      isSessionGatedImageSrc("/api/thumbnails/projects/p1?photoId=x")
    ).toBe(true);
  });

  it("does not match remote signed URLs or unrelated local paths", () => {
    expect(
      isSessionGatedImageSrc("https://bucket.r2.cloudflarestorage.com/x")
    ).toBe(false);
    expect(isSessionGatedImageSrc("/api/thumbnails-other/x")).toBe(false);
    expect(isSessionGatedImageSrc("/images/hero.webp")).toBe(false);
  });
});
