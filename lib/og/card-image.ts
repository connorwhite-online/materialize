/**
 * Pure helpers behind the OG card renderer, kept out of
 * `render-card.tsx` so they can be unit-tested without importing
 * `next/og` (which drags in satori and a WASM resvg build).
 */

import { deriveAppUrl } from "@/lib/utils/request-url";

/**
 * Resolve an image reference into something `fetch` will accept.
 *
 * `files.thumbnailUrl` is stored as a RELATIVE same-origin path
 * (`/api/thumbnails/{fileId}`) — see `app/api/thumbnails/route.ts`,
 * which deliberately stores the stable redirect URL rather than a
 * presigned R2 one (S3 presigned URLs cap at 7 days, and next/image's
 * optimizer will not follow redirects).
 *
 * Node's `fetch` rejects a relative URL outright:
 *
 *     > fetch('/api/thumbnails/abc')
 *     TypeError: Failed to parse URL from /api/thumbnails/abc
 *
 * `fetchImageDataUrl` swallowed that in its catch and returned null, so
 * every file OG card silently rendered the no-image placeholder — the
 * artwork had never once appeared in a link preview. Resolve against
 * the live request host instead. `deriveAppUrl()` reads the forwarded
 * host headers rather than NEXT_PUBLIC_APP_URL, which bakes at build
 * time and falls back to localhost in production.
 */
export async function resolveImageUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:")) return url;
  // A protocol-relative reference resolves against the base's SCHEME,
  // not its host — `new URL("//evil.example/x", "https://materialize.cc")`
  // is `https://evil.example/x`. It passes a naive leading-slash check
  // and then sends this renderer fetching an arbitrary host, so reject
  // it before the leading-slash branch, not after.
  if (url.startsWith("//")) return null;
  // Anything else — a bare storage key, a `javascript:` string — has no
  // defensible resolution here. Returning null renders the no-image
  // card, which is the honest outcome.
  if (!url.startsWith("/")) return null;
  try {
    return new URL(url, await deriveAppUrl()).toString();
  } catch {
    return null;
  }
}

/**
 * Whether to render the full-bleed card.
 *
 * Full-bleed only means anything when there is artwork to bleed —
 * without an image it would emit a flat rectangle, so a `"full"`
 * request degrades to the split card, which at least states what the
 * link is.
 */
export function shouldFullBleed(
  layout: "split" | "full" | undefined,
  hasImage: boolean
): boolean {
  return layout === "full" && hasImage;
}
