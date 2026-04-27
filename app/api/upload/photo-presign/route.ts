import { auth } from "@clerk/nextjs/server";
import { generateUploadUrl } from "@/lib/storage";
import { nanoid } from "nanoid";
import { sanitizeFilename } from "../presign/route";
import { logError } from "@/lib/logger";

/**
 * Presign for part-photo uploads (real-world photos of a printed
 * object), separate from model-file presign so the validation rules
 * don't collide. Photos are JPG/PNG/WEBP at user-camera sizes; STLs
 * are 200MB binary blobs at modeling-software sizes.
 *
 * Storage key is rooted at `photos/<userId>/<nanoid>/...` so:
 *   - the cleanup-orphan-uploads sweep doesn't touch it (its prefix
 *     scan is `uploads/`)
 *   - addFilePhoto's prefix check can verify the caller owns the key
 *   - a malicious client can't get a signed PUT to someone else's
 *     prefix
 */
const ACCEPTED_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB — typical phone photo

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { filename, contentType, fileSize } = body as {
      filename?: string;
      contentType?: string;
      fileSize?: number;
    };

    if (!filename || typeof filename !== "string") {
      return Response.json({ error: "Filename is required" }, { status: 400 });
    }
    if (
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize) ||
      fileSize <= 0
    ) {
      return Response.json({ error: "Invalid file size" }, { status: 400 });
    }
    if (fileSize > MAX_PHOTO_SIZE) {
      return Response.json(
        { error: "Photo exceeds 10MB limit" },
        { status: 400 }
      );
    }

    const ct = (contentType ?? "").toLowerCase();
    const ext = ACCEPTED_PHOTO_TYPES[ct];
    if (!ext) {
      return Response.json(
        { error: "Unsupported photo format. Accepted: JPG, PNG, WEBP" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFilename(filename);
    const storageKey = `photos/${userId}/${nanoid()}/${safeName}`;
    const uploadUrl = await generateUploadUrl(storageKey, ct);

    return Response.json({ uploadUrl, storageKey });
  } catch (error) {
    logError("api/upload/photo-presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
