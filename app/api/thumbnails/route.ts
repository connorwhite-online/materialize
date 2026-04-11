import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateUploadUrl, generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

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

    // Upload thumbnail to R2
    const storageKey = `thumbnails/${fileId}.webp`;
    const uploadUrl = await generateUploadUrl(storageKey, "image/webp", 300);

    await fetch(uploadUrl, {
      method: "PUT",
      body: buffer,
      headers: { "Content-Type": "image/webp" },
    });

    // Get a long-lived public URL and store it
    const thumbnailUrl = await generateDownloadUrl(storageKey, 60 * 60 * 24 * 365);

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
