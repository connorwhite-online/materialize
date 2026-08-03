/**
 * A 1×1 transparent PNG served when a thumbnail asset is genuinely
 * absent — a missing/deleted file row, a row with no recorded
 * thumbnail, a draft requested by a non-owner, or a `thumbnailUrl`
 * that points at an R2 object that no longer exists.
 *
 * Why 200-placeholder instead of 404/502 (issue #63): the `/files`
 * browse grid renders thumbnails through next/image, and the
 * pr-browser-review smoke spec asserts ZERO same-origin network
 * failures on the core routes (`/files`, `/materials`, `/print`). A
 * stale preview-seed row that points at a missing thumbnail object
 * used to 404 here, tripping that assertion and flapping the CI
 * `review` check even when the substantive verdict was clean.
 * Returning a valid (transparent) image keeps next/image's optimizer
 * happy and turns the failure into a clean empty tile — the card
 * already paints a muted gradient behind the transparent pixel.
 *
 * What this deliberately does NOT swallow:
 *   - Malformed (non-UUID) ids still 404 — they never come from our
 *     own UI, and 404ing them preserves the anti-scrape / anti-DB-
 *     error behaviour (sentry 7484237159).
 *   - Genuine upstream infra failures (R2 5xx / network errors) still
 *     502 — those are real problems we want surfaced, not masked.
 *
 * The PNG bytes were generated with a deflate of a single
 * filter-byte + RGBA(0,0,0,0) scanline (see the route tests for the
 * shape); 68 bytes, color type 6 (RGBA), so the alpha channel is
 * honoured by the optimizer.
 */
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

const TRANSPARENT_PNG_BYTES = Uint8Array.from(
  Buffer.from(TRANSPARENT_PNG_BASE64, "base64")
);

export function thumbnailPlaceholderResponse(): Response {
  return new Response(TRANSPARENT_PNG_BYTES, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Short TTL so a freshly-seeded real thumbnail replaces the
      // placeholder within a minute, rather than being cached for the
      // full published-thumbnail lifetime.
      "Cache-Control": "public, max-age=60",
      // Belt-and-suspenders — this branch always serves our own known
      // PNG bytes, but every response out of the thumbnail proxies
      // carries nosniff so none of them can be coerced into a
      // browser-guessed content type. See resolveSafeImageContentType
      // below for the branches that actually stream uploader bytes.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * SEC-1 — the thumbnail proxies stream R2 bytes back to the browser
 * same-origin. R2 stores whatever Content-Type the *uploader* set at
 * presign time; echoing that string verbatim lets a malicious upload
 * (e.g. `text/html`, `image/svg+xml`) get served same-origin with a
 * browser-sniffable type, which is a stored-XSS vector. Only echo a
 * content-type from a fixed raster-image allowlist; anything else
 * downgrades to a forced download (`application/octet-stream` +
 * `Content-Disposition: attachment`) so the browser never renders it
 * inline. Every response — including this fallback — also carries
 * `X-Content-Type-Options: nosniff` so a legacy/misbehaving browser
 * can't sniff its way around the allowlist.
 */
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function resolveSafeImageContentType(
  upstreamContentType: string | null,
  /** True when the storage key itself is a known-safe auto-captured `.webp` path. */
  defaultToWebp: boolean
): { contentType: string; isAttachment: boolean } {
  const ct = (upstreamContentType ?? "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_IMAGE_CONTENT_TYPES.has(ct)) {
    return { contentType: ct, isAttachment: false };
  }
  if (!ct && defaultToWebp) {
    return { contentType: "image/webp", isAttachment: false };
  }
  return { contentType: "application/octet-stream", isAttachment: true };
}
