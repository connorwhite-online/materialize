import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";

export async function POST(request: Request) {
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

  // Verify the storage key belongs to this user
  if (!storageKey.startsWith(`uploads/${userId}/`)) {
    return Response.json({ error: "Invalid storage key" }, { status: 403 });
  }

  const [asset] = await db
    .insert(fileAssets)
    .values({
      fileId: "00000000-0000-0000-0000-000000000000", // placeholder, linked when listing is created
      storageKey,
      originalFilename,
      format,
      fileSize,
    })
    .returning();

  return Response.json({ asset });
}
