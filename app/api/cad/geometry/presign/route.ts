import { auth, currentUser } from "@clerk/nextjs/server";

import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { buildGeometryKey } from "@/lib/cad/geometry-refs";
import {
  MAX_SCAN_BYTES,
  SCAN_FILE_TYPES,
  scanFileTypeFromName,
} from "@/lib/cad/scan-tiers";
import { canUseTextToCad } from "@/lib/features";
import { logError } from "@/lib/logger";
import { generateUploadUrl } from "@/lib/storage";

/**
 * Presign one studio geometry upload (a scan, or a STEP to remix).
 *
 * A separate route from the generate call rather than another base64 field on
 * it, because the size classes are nothing alike: reference images ride inline
 * capped at ~6.5MB of base64, while a phone scan is tens of megabytes. Pushing
 * that through the JSON body would blow the request limit and hold a serverless
 * invocation open for the whole transfer. The browser PUTs straight to R2 and
 * sends back only the key.
 *
 * Ownership is carried by the key's own prefix (`cad-geo/<userId>/`), which is
 * what `sanitizeAttachedGeometry` re-checks when the key comes back on the
 * generate request — so a forged key never reaches storage.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    // 404, not 403: the studio is owner-gated and must not admit it exists.
    const user = (await currentUser()) as ClerkUserLike | null;
    if (!canUseTextToCad(primaryEmail(user))) {
      return new Response("Not found", { status: 404 });
    }

    const body = (await request.json()) as {
      filename?: unknown;
      contentType?: unknown;
      fileSize?: unknown;
    };

    const filename = typeof body.filename === "string" ? body.filename : "";
    if (!filename) {
      return Response.json({ error: "Filename is required" }, { status: 400 });
    }

    const fileSize = body.fileSize;
    if (
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize) ||
      fileSize <= 0
    ) {
      return Response.json({ error: "Invalid file size" }, { status: 400 });
    }
    if (fileSize > MAX_SCAN_BYTES) {
      return Response.json(
        {
          error: `Scan exceeds ${Math.round(MAX_SCAN_BYTES / 1024 / 1024)}MB. Export it at a lower density and try again.`,
        },
        { status: 400 }
      );
    }

    const fileType = scanFileTypeFromName(filename);
    if (!fileType) {
      return Response.json(
        {
          error: `Unsupported format. Accepted: ${SCAN_FILE_TYPES.map((f) => f.toUpperCase()).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // The extension carries the format and the nanoid the identity, so the
    // user's filename never reaches the key — nothing to sanitize, and no
    // way to shape a path from it.
    const storageKey = buildGeometryKey(userId, fileType);
    const uploadUrl = await generateUploadUrl(
      storageKey,
      typeof body.contentType === "string" && body.contentType
        ? body.contentType
        : "application/octet-stream"
    );

    return Response.json({ uploadUrl, storageKey, fileType });
  } catch (error) {
    logError("api/cad/geometry/presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
