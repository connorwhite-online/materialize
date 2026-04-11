import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { storageKey, originalFilename, format, fileSize } = body as {
      storageKey: string;
      originalFilename: string;
      format: "stl" | "obj" | "3mf" | "step" | "amf";
      fileSize: number;
    };

    if (!storageKey || !originalFilename || !format) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!storageKey.startsWith(`uploads/${userId}/`)) {
      return Response.json({ error: "Invalid storage key" }, { status: 403 });
    }

    // Compute content hash before inserting — ensures anti-piracy check works
    let contentHash: string | null = null;
    try {
      contentHash = await computeContentHash(storageKey);
    } catch (err) {
      logError("contentHash", err);
      // Continue without hash — file is still usable, anti-piracy check will be skipped
    }

    const [asset] = await db
      .insert(fileAssets)
      .values({
        fileId: null, // linked when listing is created
        storageKey,
        originalFilename,
        format,
        fileSize,
        contentHash,
      })
      .returning();

    return Response.json({ asset });
  } catch (error) {
    logError("api/upload/complete", error);
    return Response.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

async function computeContentHash(storageKey: string): Promise<string> {
  const { createHash } = await import("crypto");
  const downloadUrl = await generateDownloadUrl(storageKey, 300);
  const res = await fetch(downloadUrl);

  if (!res.ok) {
    throw new Error(`Failed to download file for hashing: ${res.status}`);
  }

  if (!res.body) {
    throw new Error("Response has no body to stream");
  }

  // Stream through SHA-256 — never loads the full file into memory
  const hash = createHash("sha256");
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }

  return hash.digest("hex");
}
