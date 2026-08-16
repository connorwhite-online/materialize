/**
 * Pure helpers behind the OG card renderer, kept out of
 * `render-card.tsx` so they can be unit-tested without importing
 * `next/og` (which drags in satori and a WASM resvg build).
 */

import sharp from "sharp";

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

/**
 * Image formats satori can put in an `<img>` without help.
 *
 * Satori rasterizes through resvg, whose decoders cover PNG, JPEG and
 * GIF; SVG it handles natively. Anything else throws from deep inside
 * the renderer — a WebP source fails with `u2 is not iterable`, which
 * names nothing and points nowhere.
 */
const SATORI_SAFE_FORMATS = new Set(["png", "jpeg", "gif", "svg"]);

const MIME_FOR_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Nothing larger than the card itself is worth carrying. */
const MAX_EDGE = 1200;

/**
 * Turn fetched image bytes into a data URL satori can actually render.
 *
 * This exists because **our file thumbnails are WebP** — the viewer
 * captures `toDataURL("image/webp")` — and satori cannot decode WebP.
 * It is not a preview-environment quirk: hand the renderer a real
 * production thumbnail and the OG route 500s. It went unnoticed only
 * because the relative-URL bug meant the fetch never once succeeded,
 * so satori was never handed the bytes. Fixing that bug is what
 * exposed this one.
 *
 * `sharp().metadata()` does double duty: it reports the true format
 * (the `content-type` header is not to be trusted — an SSO gate or an
 * error page will happily return HTML under a 200) and it throws on
 * anything that is not a decodable image, which is exactly the signal
 * we want. Callers treat null as "render the no-image card".
 */
export async function toSatoriSafeDataUrl(
  buf: Buffer
): Promise<string | null> {
  try {
    const { format } = await sharp(buf).metadata();
    if (!format) return null;

    if (SATORI_SAFE_FORMATS.has(format)) {
      const mime = MIME_FOR_FORMAT[format];
      if (!mime) return null;
      return `data:${mime};base64,${buf.toString("base64")}`;
    }

    // WebP, AVIF, TIFF, … — transcode. Bounded to the card's own size
    // so a large source cannot balloon into a multi-megabyte PNG held
    // in memory purely to be downscaled by the renderer anyway.
    const png = await sharp(buf)
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
