import { auth } from "@clerk/nextjs/server";
import { generateUploadUrl } from "@/lib/storage";
import { nanoid } from "nanoid";
import { sanitizeFilename } from "../presign/route";
import { logError } from "@/lib/logger";

/**
 * Presign for circuit / wiring uploads attached to a project. Accepts
 * image diagrams (PNG/SVG/JPG/WEBP) and KiCad source files
 * (.kicad_sch / .kicad_pcb / .kicad_pro). Fritzing `.fzz` and Gerber
 * zips will hook into this same route later.
 *
 * Storage rooted at `circuits/<userId>/<nanoid>/...` so it can't
 * collide with the photo or model-file prefixes and the server action
 * can prefix-check the key the client returns.
 */
const ACCEPTED_CIRCUIT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// Source files don't have registered browser MIME types — browsers
// send `application/octet-stream` (or an empty type) and we accept
// based on extension instead. Mapped to a normalized extension to
// keep the storage key tidy.
const ACCEPTED_CIRCUIT_EXTENSIONS = new Set([
  "kicad_sch",
  "kicad_pcb",
  "kicad_pro",
]);

// 20MB ceiling. Hobby wiring diagrams are small, but Fritzing source
// files (phase 2) can run several MB and Gerber zips (phase 3) up to
// 20–30MB; setting the bar here means later phases don't have to
// touch the gateway again.
const MAX_CIRCUIT_SIZE = 20 * 1024 * 1024;

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
    if (fileSize > MAX_CIRCUIT_SIZE) {
      return Response.json(
        { error: "Upload exceeds 20MB limit" },
        { status: 400 }
      );
    }

    const ct = (contentType ?? "").toLowerCase();
    const lowerName = filename.toLowerCase();
    const filenameExt = lowerName.split(".").pop() ?? "";

    // Images: validated by their declared content-type.
    // KiCad sources: validated by file extension since browsers don't
    // register MIME types for these — content-type is typically
    // `application/octet-stream` or "" depending on platform.
    const imageExt = ACCEPTED_CIRCUIT_TYPES[ct];
    const isKicad = ACCEPTED_CIRCUIT_EXTENSIONS.has(filenameExt);
    if (!imageExt && !isKicad) {
      return Response.json(
        {
          error:
            "Unsupported format. Accepted: JPG/PNG/WEBP/SVG image or .kicad_sch / .kicad_pcb / .kicad_pro",
        },
        { status: 400 }
      );
    }

    // Force octet-stream for source files so the R2 signed PUT
    // doesn't reject a mismatch between the PUT content-type and the
    // presign — and so subsequent GETs serve as a plain download
    // rather than the browser trying to render the bytes.
    const signedContentType = imageExt ? ct : "application/octet-stream";
    const safeName = sanitizeFilename(filename);
    const storageKey = `circuits/${userId}/${nanoid()}/${safeName}`;
    const uploadUrl = await generateUploadUrl(storageKey, signedContentType);

    return Response.json({ uploadUrl, storageKey });
  } catch (error) {
    logError("api/upload/circuit-presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
