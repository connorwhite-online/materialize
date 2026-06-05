/**
 * Client-side helper that runs the two-step photo upload — presign
 * with the API route, then PUT the bytes at the returned R2 URL.
 * Used by both the carousel uploader and the comment composer's
 * attach-photo path so they share the same client-side gates and
 * error shape.
 *
 * Returns the storageKey on success; throws on failure with a
 * human-readable message suitable for surfacing to the user.
 */
import { reportClientError } from "@/lib/observability/report-client-error";

export const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function validatePhoto(file: File): string | null {
  if (!ACCEPTED_PHOTO_MIME.has(file.type.toLowerCase())) {
    return "JPG, PNG, or WEBP only.";
  }
  if (file.size > MAX_PHOTO_SIZE) {
    return "Photo exceeds 10MB.";
  }
  return null;
}

export async function uploadPhotoToR2(
  file: File
): Promise<{ storageKey: string }> {
  const presignRes = await fetch("/api/upload/photo-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name || "pasted-image",
      contentType: file.type,
      fileSize: file.size,
    }),
  });
  if (!presignRes.ok) {
    const data = await presignRes.json().catch(() => ({}));
    throw new Error(
      data.error || `Failed to get upload URL (${presignRes.status})`
    );
  }
  const { uploadUrl, storageKey } = (await presignRes.json()) as {
    uploadUrl: string;
    storageKey: string;
  };
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!putRes.ok) {
    reportClientError(
      "upload.r2-put-failed",
      new Error(`Photo upload failed (${putRes.status})`),
      { status: putRes.status, kind: "photo", fileSize: file.size }
    );
    throw new Error(`Photo upload failed (${putRes.status})`);
  }
  return { storageKey };
}
