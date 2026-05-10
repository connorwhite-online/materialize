import { auth } from "@clerk/nextjs/server";
import { generateUploadUrl } from "@/lib/storage";
import { nanoid } from "nanoid";
import { sanitizeFilename } from "../presign/route";
import { logError } from "@/lib/logger";

/**
 * Presign for circuit / wiring uploads attached to a project. Phase 1
 * accepts image diagrams only (PNG/SVG/JPG/WEBP); subsequent phases
 * widen this to Fritzing `.fzz`, KiCad `.kicad_sch`/`.kicad_pcb`, and
 * Gerber zips.
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
    const ext = ACCEPTED_CIRCUIT_TYPES[ct];
    if (!ext) {
      return Response.json(
        { error: "Unsupported format. Accepted: JPG, PNG, WEBP, SVG" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFilename(filename);
    const storageKey = `circuits/${userId}/${nanoid()}/${safeName}`;
    const uploadUrl = await generateUploadUrl(storageKey, ct);

    return Response.json({ uploadUrl, storageKey });
  } catch (error) {
    logError("api/upload/circuit-presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
