import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { anonUploadGrants } from "@/lib/db/schema";
import { generateUploadUrl } from "@/lib/storage";
import { fileExtensionToFormat, MAX_FILE_SIZE } from "@/lib/validations/file";
import { logError } from "@/lib/logger";
import {
  ANON_UPLOAD_PREFIX,
  checkAnonUploadLimit,
  clientIpFrom,
  hashIp,
} from "@/lib/uploads/anon-grants";
import { sanitizeFilename } from "../presign/route";

/**
 * Presigned R2 upload for an UNAUTHENTICATED visitor on the anon print
 * flow — the counterpart to /api/upload/presign, which requires a
 * Clerk session and derives its key from the userId.
 *
 * This exists only because CraftCloud's replacement upload endpoints
 * refuse our origin, so an anon visitor's model can no longer go
 * browser → CraftCloud and must transit R2 + our server instead.
 *
 * Handing an anonymous caller a write into the bucket is fenced by:
 *   - a per-IP sliding-window cap that fails CLOSED,
 *   - a dedicated `anon-uploads/` prefix nothing else writes to,
 *   - a single-use grant row, so /api/craftcloud/upload-model will
 *     only ever read a key we actually issued,
 *   - the same size + format validation the authed route applies.
 *
 * Objects here are transient staging for the CraftCloud upload, not
 * user content: they are never linked to a fileAssets row, and the
 * daily orphan-cleanup cron sweeps the prefix. The real upload still
 * happens at checkout, after sign-up, under the new owner's key.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIpFrom(request.headers);
    if (!ip) {
      // An unauthenticated write we cannot attribute to anything is
      // exactly what the cap exists to prevent — refuse rather than
      // let a stripped header opt out of rate limiting.
      return Response.json(
        { error: "Could not determine client address" },
        { status: 400 }
      );
    }
    const ipHash = hashIp(ip);

    const limit = await checkAnonUploadLimit(ipHash);
    if (!limit.ok) {
      return Response.json(
        { error: "Too many uploads. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      );
    }

    const { filename, contentType, fileSize } = (await request.json()) as {
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
    if (fileSize > MAX_FILE_SIZE) {
      return Response.json(
        { error: "File exceeds 200MB limit" },
        { status: 400 }
      );
    }

    const format = fileExtensionToFormat(filename);
    if (!format) {
      return Response.json(
        {
          error:
            "Unsupported file format. Accepted: STL, OBJ, 3MF, STEP, AMF",
        },
        { status: 400 }
      );
    }

    const safeName = sanitizeFilename(filename);
    const storageKey = `${ANON_UPLOAD_PREFIX}${nanoid()}/${safeName}`;

    // Record the grant BEFORE handing out the URL: the row is both the
    // rate-limit tally and the authorization record, and a URL that
    // exists without one would be a write we can neither count nor
    // later verify.
    await db.insert(anonUploadGrants).values({
      ipHash,
      storageKey,
      originalFilename: safeName,
      fileSize,
    });

    const uploadUrl = await generateUploadUrl(
      storageKey,
      contentType || "application/octet-stream"
    );

    return Response.json({ uploadUrl, storageKey, format });
  } catch (error) {
    logError("api/upload/anon-presign", error);
    return Response.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}
