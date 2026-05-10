/**
 * Client-side helper for the circuit / wiring upload — presign with
 * /api/upload/circuit-presign, then PUT the bytes at the returned R2
 * URL. Phase 1 accepts only image diagrams; the validation here will
 * widen as later phases accept source files (Fritzing .fzz, KiCad
 * .kicad_*, Gerber zips).
 *
 * Returns the storageKey on success; throws on failure with a
 * human-readable message.
 */
export const MAX_CIRCUIT_SIZE = 20 * 1024 * 1024;
export const ACCEPTED_CIRCUIT_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

export function validateCircuitImage(file: File): string | null {
  if (!ACCEPTED_CIRCUIT_IMAGE_MIME.has(file.type.toLowerCase())) {
    return "JPG, PNG, WEBP, or SVG only.";
  }
  if (file.size > MAX_CIRCUIT_SIZE) {
    return "File exceeds 20MB.";
  }
  return null;
}

export async function uploadCircuitToR2(
  file: File
): Promise<{ storageKey: string }> {
  const presignRes = await fetch("/api/upload/circuit-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name || "circuit",
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
    throw new Error(`Upload failed (${putRes.status})`);
  }
  return { storageKey };
}
