import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import sharp from "sharp";
import { generateUploadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Uploads a captured thumbnail to R2 and stores a stable relative
 * URL (`/api/thumbnails/{fileId}`) in the files row.
 *
 * The GET handler in `app/api/thumbnails/[fileId]/route.ts` streams
 * the bytes back through this origin after signing a fresh R2 URL
 * server-side, which works around S3 presigned URLs' 7-day maximum
 * expiration AND is consumable by next/image's optimizer (which
 * does not follow redirects).
 */

// SEC-3 — this route's `dataUrl` is caller-controlled (it's the raw
// output of a client-side canvas capture). Before this fix there was
// no size cap and no verification that the decoded bytes were
// actually an image, so an oversized or forged payload could be
// PUT to R2 under a `thumbnails/{fileId}.webp` key and later get
// streamed back same-origin by the GET route. Keep the prefix pinned
// to a closed allowlist, cap the decoded size, and verify the
// declared format's magic bytes before the R2 PUT.
//
// The allowlist has TWO entries, not one, because the capture asks
// for WebP and does not always get it. `canvas.toDataURL(type)` is
// specified to fall back to PNG — silently, with no error and no
// signal — for any type the browser cannot encode, and Safari decodes
// WebP but does not encode it. So every capture taken on iOS arrives
// here as `data:image/png;base64,…`.
//
// Requiring WebP therefore 400'd every mobile-Safari capture. That was
// visible as "Couldn't update" on the viewer's Update-preview button,
// and INVISIBLE for the automatic first capture, which only
// console.warns — an iPhone upload simply never got a thumbnail.
//
// See: https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-todataurl
const ACCEPTED_DATA_URL_PREFIXES = {
  "data:image/webp;base64,": "webp",
  "data:image/png;base64,": "png",
} as const;

type AcceptedFormat =
  (typeof ACCEPTED_DATA_URL_PREFIXES)[keyof typeof ACCEPTED_DATA_URL_PREFIXES];

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5MB — generous for a captured viewport screenshot, PNG included
// Base64 encodes 3 bytes as 4 chars; reject the string outright if it
// couldn't possibly decode within budget, before ever calling
// Buffer.from on caller-controlled input.
const MAX_BASE64_LENGTH = Math.ceil(MAX_THUMBNAIL_BYTES / 3) * 4;
const LONGEST_PREFIX = Math.max(
  ...Object.keys(ACCEPTED_DATA_URL_PREFIXES).map((p) => p.length)
);

/** The declared format, or null when the prefix isn't on the allowlist. */
function formatFromDataUrl(dataUrl: string): AcceptedFormat | null {
  for (const [prefix, format] of Object.entries(ACCEPTED_DATA_URL_PREFIXES)) {
    if (dataUrl.startsWith(prefix)) return format;
  }
  return null;
}

const bodySchema = z.object({
  fileId: z.string().min(1),
  dataUrl: z
    .string()
    .min(1)
    .refine(
      (v) => formatFromDataUrl(v) !== null,
      "dataUrl must be a base64 image/webp or image/png data URL"
    )
    .max(LONGEST_PREFIX + MAX_BASE64_LENGTH, "Thumbnail payload too large"),
});

/** True when `buf` starts with the WebP container's RIFF/WEBP magic bytes. */
function isValidWebpMagicBytes(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

/** True when `buf` starts with the PNG signature. */
function isValidPngMagicBytes(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

/** The bytes must match the format the caller declared — no sniffing past it. */
function hasValidMagicBytes(buf: Buffer, format: AcceptedFormat): boolean {
  return format === "webp"
    ? isValidWebpMagicBytes(buf)
    : isValidPngMagicBytes(buf);
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 }
      );
    }
    const { fileId, dataUrl } = parsed.data;

    // Verify ownership
    const [file] = await db
      .select({ id: files.id, userId: files.userId })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    // Convert data URL to buffer — the schema already pinned the
    // prefix to one of the allowlisted forms, so slicing it off is
    // safe. Re-derive the format rather than trusting a second parse.
    const format = formatFromDataUrl(dataUrl);
    if (!format) {
      return Response.json({ error: "Invalid data URL" }, { status: 400 });
    }
    const prefixLength = Object.keys(ACCEPTED_DATA_URL_PREFIXES).find((p) =>
      dataUrl.startsWith(p)
    )!.length;
    const base64 = dataUrl.slice(prefixLength);
    if (!base64) {
      return Response.json({ error: "Invalid data URL" }, { status: 400 });
    }
    let buffer: Buffer<ArrayBuffer> = Buffer.from(base64, "base64");
    if (buffer.length > MAX_THUMBNAIL_BYTES) {
      return Response.json(
        { error: "Thumbnail payload too large" },
        { status: 400 }
      );
    }
    if (!hasValidMagicBytes(buffer, format)) {
      return Response.json(
        { error: `Decoded payload is not a valid ${format.toUpperCase()} image` },
        { status: 400 }
      );
    }

    // Normalize to WebP so storage stays single-format. The key, the
    // stored Content-Type and every downstream consumer then hold
    // regardless of which encoder the capturing browser happened to
    // have — a PNG from Safari lands identically to a WebP from
    // Chrome, and nothing further down has to branch.
    if (format === "png") {
      try {
        buffer = Buffer.from(
          await sharp(buffer).webp({ quality: 85 }).toBuffer()
        );
      } catch (error) {
        logError("api/thumbnails:transcode", error);
        return Response.json(
          { error: "Could not process the captured image" },
          { status: 400 }
        );
      }
    }

    // Upload thumbnail to R2.
    const storageKey = `thumbnails/${fileId}.webp`;
    const uploadUrl = await generateUploadUrl(storageKey, "image/webp", 300);

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      body: buffer,
      headers: { "Content-Type": "image/webp" },
    });
    if (!putRes.ok) {
      const body = await putRes.text().catch(() => "");
      throw new Error(`R2 PUT failed ${putRes.status}: ${body}`);
    }

    // Store the stable redirect URL, not a pre-signed download URL.
    //
    // The `v` suffix is a cache buster. The R2 key is derived from the
    // file id, so re-capturing overwrites the same object behind the
    // same URL — and the GET route serves it `public, max-age=300`
    // (`app/api/thumbnails/[fileId]/route.ts`). Without a changing
    // URL, a creator who re-shoots their preview keeps being served
    // the old image by their own browser and by any CDN in front of
    // us, which reads as the save having silently failed. Nothing
    // parses this column's shape — consumers either hand it straight
    // to an <img>/next/image `src` or test it for an `http(s)://`
    // prefix, both of which are indifferent to a query string.
    const thumbnailUrl = `/api/thumbnails/${fileId}?v=${Date.now().toString(36)}`;

    await db
      .update(files)
      .set({ thumbnailUrl })
      .where(eq(files.id, fileId));

    return Response.json({ thumbnailUrl });
  } catch (error) {
    logError("api/thumbnails", error);
    return Response.json({ error: "Failed to save thumbnail" }, { status: 500 });
  }
}
