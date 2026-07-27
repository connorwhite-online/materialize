import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
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
// actually a WebP image, so an oversized or forged payload could be
// PUT to R2 under a `thumbnails/{fileId}.webp` key and later get
// streamed back same-origin by the GET route. Lock the prefix down
// to exactly the one format this route ever produces, cap the
// decoded size, and verify the WebP RIFF/WEBP magic bytes before the
// R2 PUT.
const DATA_URL_PREFIX = "data:image/webp;base64,";
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5MB — generous for a captured viewport screenshot
// Base64 encodes 3 bytes as 4 chars; reject the string outright if it
// couldn't possibly decode within budget, before ever calling
// Buffer.from on caller-controlled input.
const MAX_BASE64_LENGTH = Math.ceil(MAX_THUMBNAIL_BYTES / 3) * 4;

const bodySchema = z.object({
  fileId: z.string().min(1),
  dataUrl: z
    .string()
    .min(1)
    .startsWith(DATA_URL_PREFIX, "dataUrl must be a base64 image/webp data URL")
    .max(DATA_URL_PREFIX.length + MAX_BASE64_LENGTH, "Thumbnail payload too large"),
});

/** True when `buf` starts with the WebP container's RIFF/WEBP magic bytes. */
function isValidWebpMagicBytes(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
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
    // prefix to exactly `data:image/webp;base64,`, so slicing it off
    // is safe.
    const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
    if (!base64) {
      return Response.json({ error: "Invalid data URL" }, { status: 400 });
    }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_THUMBNAIL_BYTES) {
      return Response.json(
        { error: "Thumbnail payload too large" },
        { status: 400 }
      );
    }
    if (!isValidWebpMagicBytes(buffer)) {
      return Response.json(
        { error: "Decoded payload is not a valid WebP image" },
        { status: 400 }
      );
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
    const thumbnailUrl = `/api/thumbnails/${fileId}`;

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
