import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateUploadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Uploads a captured thumbnail to R2 and stores a stable relative
 * URL (`/api/thumbnails/{fileId}`) in the files row.
 *
 * The GET handler in `app/api/thumbnails/[fileId]/route.ts` redirects
 * each request to a freshly signed short-lived R2 URL, which works
 * around S3 presigned URLs' 7-day maximum expiration. `<img>` tags
 * follow the redirect transparently.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId, dataUrl } = (await request.json()) as {
      fileId: string;
      dataUrl: string;
    };

    if (!fileId || !dataUrl) {
      return Response.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify ownership
    const [file] = await db
      .select({ id: files.id, userId: files.userId })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    // Convert data URL to buffer
    const base64 = dataUrl.split(",")[1];
    if (!base64) {
      return Response.json({ error: "Invalid data URL" }, { status: 400 });
    }
    const buffer = Buffer.from(base64, "base64");

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
