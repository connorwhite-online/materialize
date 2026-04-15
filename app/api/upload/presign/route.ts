import { auth } from "@clerk/nextjs/server";
import { generateUploadUrl } from "@/lib/storage";
import { nanoid } from "nanoid";
import { fileExtensionToFormat, MAX_FILE_SIZE } from "@/lib/validations/file";
import { logError } from "@/lib/logger";

/**
 * Strip characters that could break a storage key (path separators,
 * newlines, control bytes, wildcards). Keeps alphanumerics, dots,
 * dashes and underscores; everything else collapses to an underscore.
 * Leading dots are trimmed so we never produce a hidden path entry.
 * Falls back to "file" if the sanitized result is only punctuation.
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._]+/, "");
  // If nothing meaningful survives, fall back to a safe default.
  if (!cleaned || /^[._-]+$/.test(cleaned)) return "file";
  return cleaned;
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { filename, contentType, fileSize } = body as {
      filename: string;
      contentType: string;
      fileSize: number;
    };

    if (!filename || typeof filename !== "string") {
      return Response.json({ error: "Filename is required" }, { status: 400 });
    }

    if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      return Response.json({ error: "Invalid file size" }, { status: 400 });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return Response.json(
        { error: "File exceeds 200MB limit" },
        { status: 400 }
      );
    }

    const format = fileExtensionToFormat(filename);
    if (!format) {
      return Response.json(
        { error: "Unsupported file format. Accepted: STL, OBJ, 3MF, STEP, AMF" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFilename(filename);
    const storageKey = `uploads/${userId}/${nanoid()}/${safeName}`;
    const uploadUrl = await generateUploadUrl(
      storageKey,
      contentType || "application/octet-stream"
    );

    return Response.json({ uploadUrl, storageKey, format });
  } catch (error) {
    logError("api/upload/presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
