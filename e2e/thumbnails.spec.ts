import { test, expect } from "@playwright/test";

/**
 * Regression test for Sentry event 7484236094.
 *
 * Next.js 16 introduced a breaking change: when `images.localPatterns` is not
 * configured, it defaults to `[{ pathname: "**", search: "" }]`, which blocks
 * ALL local image URLs that contain a query string from the built-in image
 * optimisation pipeline (`/_next/image`).
 *
 * The files browse page (`GET /files`) constructs carousel URLs of the form
 *   /api/thumbnails/{fileId}?photoId={photoId}
 * for curator photos beyond the cover image.  Without `localPatterns`
 * configured to allow a non-empty search string, `/_next/image` rejects those
 * URLs with HTTP 400 "url" parameter is not allowed".
 *
 * Fix: `next.config.ts` must declare `images.localPatterns` entries that
 * permit the thumbnail path with arbitrary query strings.
 */
test.describe("thumbnail localPatterns (Sentry 7484236094)", () => {
  /**
   * /_next/image with a thumbnail URL that carries a ?photoId= query string
   * must NOT be rejected as "url parameter is not allowed".
   *
   * Before fix: Next.js 16 default localPatterns = [{ pathname: "**", search: "" }]
   *   → hasLocalMatch returns false  → 400 "url" parameter is not allowed
   *
   * After fix: localPatterns explicitly allows /api/thumbnails/** with any
   *   search → hasLocalMatch returns true → the request gets past validation
   *   (it may still 4xx for an unrelated reason such as a non-existent file in
   *   the test environment, but it will NOT fail with the localPatterns error).
   */
  test("/_next/image accepts /api/thumbnails/{id}?photoId={id} URLs", async ({
    request,
  }) => {
    // Use sentinel UUIDs — no real file needed; we only care that the
    // request reaches the optimiser past the localPatterns gate.
    const fileId = "ba14f9ed-106b-46e3-8ed2-63bba927863d";
    const photoId = "10d08471-3aa7-44ee-8562-d889c2d276bf";

    // w=640 is always in Next.js deviceSizes; q=75 is the default quality.
    const url = `/_next/image?url=%2Fapi%2Fthumbnails%2F${fileId}%3FphotoId%3D${photoId}&w=640&q=75`;
    const res = await request.get(url, { maxRedirects: 0 });

    const body = await res.text();

    // The localPatterns gate returns 400 with exactly this body.
    // Any other status / body means the request passed validation.
    const isLocalPatternsError =
      res.status() === 400 && body.includes('"url" parameter is not allowed');

    expect(
      isLocalPatternsError,
      `/_next/image rejected the thumbnail URL with the localPatterns gate error.\n` +
        `HTTP ${res.status()}: ${body}\n\n` +
        `Fix: add images.localPatterns to next.config.ts so that ` +
        `/api/thumbnails/** with an arbitrary search string is permitted.`
    ).toBe(false);
  });

  /**
   * Same check for the project-thumbnails path that carries the same
   * ?photoId= query string pattern.
   */
  test("/_next/image accepts /api/thumbnails/projects/{id}?photoId={id} URLs", async ({
    request,
  }) => {
    const projectId = "ba14f9ed-106b-46e3-8ed2-63bba927863d";
    const photoId = "10d08471-3aa7-44ee-8562-d889c2d276bf";

    const url = `/_next/image?url=%2Fapi%2Fthumbnails%2Fprojects%2F${projectId}%3FphotoId%3D${photoId}&w=640&q=75`;
    const res = await request.get(url, { maxRedirects: 0 });

    const body = await res.text();

    const isLocalPatternsError =
      res.status() === 400 && body.includes('"url" parameter is not allowed');

    expect(
      isLocalPatternsError,
      `/_next/image rejected the project thumbnail URL with the localPatterns gate error.\n` +
        `HTTP ${res.status()}: ${body}\n\n` +
        `Fix: add images.localPatterns to next.config.ts so that ` +
        `/api/thumbnails/projects/** with an arbitrary search string is permitted.`
    ).toBe(false);
  });
});
