/**
 * Client-side helper for the circuit / wiring upload — presign with
 * /api/upload/circuit-presign, then PUT the bytes at the returned R2
 * URL. Accepts image diagrams and KiCad source files; Fritzing .fzz
 * and Gerber zips will hook in via the same helper later.
 *
 * Returns the storageKey on success; throws on failure with a
 * human-readable message.
 */
import { reportClientError } from "@/lib/observability/report-client-error";

export const MAX_CIRCUIT_SIZE = 20 * 1024 * 1024;
export const ACCEPTED_CIRCUIT_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);
export const ACCEPTED_KICAD_EXTENSIONS = [
  ".kicad_sch",
  ".kicad_pcb",
  ".kicad_pro",
];

function lowerExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function isKicadFile(file: File): boolean {
  return ACCEPTED_KICAD_EXTENSIONS.includes(lowerExtension(file.name));
}

export function validateCircuitImage(file: File): string | null {
  if (!ACCEPTED_CIRCUIT_IMAGE_MIME.has(file.type.toLowerCase())) {
    return "JPG, PNG, WEBP, or SVG only.";
  }
  if (file.size > MAX_CIRCUIT_SIZE) {
    return "File exceeds 20MB.";
  }
  return null;
}

export function validateCircuitKicad(file: File): string | null {
  if (!isKicadFile(file)) {
    return "Pick a .kicad_sch, .kicad_pcb, or .kicad_pro file.";
  }
  if (file.size > MAX_CIRCUIT_SIZE) {
    return "File exceeds 20MB.";
  }
  return null;
}

export async function uploadCircuitToR2(
  file: File
): Promise<{ storageKey: string }> {
  // For source files (.kicad_*) browsers leave file.type empty —
  // normalize to octet-stream so the presign signs and the PUT
  // sends the same content-type and R2's signature check passes.
  const kicad = isKicadFile(file);
  const contentType = kicad
    ? "application/octet-stream"
    : file.type || "application/octet-stream";

  const presignRes = await fetch("/api/upload/circuit-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name || "circuit",
      contentType,
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
    headers: { "Content-Type": contentType },
  });
  if (!putRes.ok) {
    reportClientError(
      "upload.r2-put-failed",
      new Error(`Circuit upload failed (${putRes.status})`),
      { status: putRes.status, kind: "circuit", fileSize: file.size }
    );
    throw new Error(`Upload failed (${putRes.status})`);
  }
  return { storageKey };
}
