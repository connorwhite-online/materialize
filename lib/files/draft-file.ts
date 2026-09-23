import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { fileAssets, files, users } from "@/lib/db/schema";
import { deleteObject, generateDownloadUrl } from "@/lib/storage";
import { buildListingSlug, deriveListingName } from "@/lib/filenames";
import { logError } from "@/lib/logger";
import { type MeshFormat } from "@/lib/hashing/mesh-fingerprint";
import { fingerprintAndPersistAsset } from "@/lib/hashing/fingerprint-asset";

/**
 * Draft-file creation for an ALREADY-AUTHENTICATED user id.
 *
 * This used to live only inside the `createDraftFileForPrint` server action,
 * which reads the user from the Clerk session. Server-side callers that know
 * the user some other way couldn't use it: the CAD persist layer called the
 * action, so saving a build through an MCP bearer token (no Clerk session)
 * always failed with "Unauthorized". The action now authenticates and
 * delegates here. This is NOT a "use server" module, so nothing here can be
 * called from a client with someone else's user id.
 */

export type CreateDraftFileParams = {
  storageKey: string;
  originalFilename: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileSize: number;
  fileUnit?: "mm" | "cm" | "in";
  /**
   * Explicit listing name. When omitted we derive it from the filename
   * (the upload-to-print default). The text-to-CAD studio passes the
   * agent-written thread title here so the profile shows a real name
   * instead of "model".
   */
  displayName?: string;
  /**
   * Provenance of the file (docs/text-to-cad/05 §B). 'upload' (default)
   * for user uploads; 'studio' for text-to-CAD drafts, which stay
   * invisible to library/profile/marketplace listings while
   * status='draft' (see lib/studio-drafts.ts) until promoted by an
   * explicit Save or a print order.
   */
  source?: "upload" | "studio";
};

// Sync helper: stream R2 -> SHA-256 of raw bytes. This is the only
// fingerprint work we do on the upload's hot path now — the geometry
// parse + canonical-sort happens deferred via fingerprintAndPersistAsset.
// Streaming hash is bandwidth-bound, ~500ms for a 50 MB file.
export async function computeByteHashOnly(
  storageKey: string
): Promise<string | null> {
  try {
    const downloadUrl = await generateDownloadUrl(storageKey, 300);
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) return null;
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.digest("hex");
  } catch (err) {
    logError("computeByteHashOnly", err);
    return null;
  }
}

// Same-user dedup: returns the existing file/asset matching THIS
// user's upload, or null. Used by both createFileListing (to surface
// an error) and createDraftFileForPrint (to silently reuse). Two
// signals:
//   1. Byte hash equal — strongest signal, only set when both
//      uploads got a non-null hash computed.
//   2. (originalFilename, fileSize) match — fallback for the case
//      where either upload's contentHash is null (computeByteHashOnly
//      failed on a transient R2/network blip) or the bytes differ
//      slightly between two exports of the same model. False
//      positives are rare within a single user's library; if
//      someone genuinely has two different files with identical name
//      and size, the upload form has an "Edit listing instead?"
//      escape hatch the wrapper surfaces.
async function findExistingSameUserAsset(params: {
  userId: string;
  byteHash: string | null;
  originalFilename: string;
  fileSize: number;
}): Promise<
  | { assetId: string; fileId: string; fileSlug: string; fileName: string }
  | null
> {
  const { userId, byteHash, originalFilename, fileSize } = params;
  if (byteHash) {
    const [hit] = await db
      .select({
        assetId: fileAssets.id,
        fileId: files.id,
        fileSlug: files.slug,
        fileName: files.name,
      })
      .from(fileAssets)
      .innerJoin(files, eq(fileAssets.fileId, files.id))
      .where(
        and(
          eq(files.userId, userId),
          eq(fileAssets.contentHash, byteHash)
        )
      )
      .limit(1);
    if (hit) return hit;
  }
  // Filename + size fallback. Restricted to non-empty filenames so we
  // never match on an empty-string default.
  if (originalFilename && fileSize > 0) {
    const [hit] = await db
      .select({
        assetId: fileAssets.id,
        fileId: files.id,
        fileSlug: files.slug,
        fileName: files.name,
      })
      .from(fileAssets)
      .innerJoin(files, eq(fileAssets.fileId, files.id))
      .where(
        and(
          eq(files.userId, userId),
          eq(fileAssets.originalFilename, originalFilename),
          eq(fileAssets.fileSize, fileSize)
        )
      )
      .limit(1);
    if (hit) return hit;
  }
  return null;
}

// Sync cross-user byte-hash check, run before INSERT. The strongest
// dedup signal and the cheapest to compute, so it stays inline.
async function checkByteHashCollision(
  byteHash: string,
  userId: string
): Promise<boolean> {
  const [hit] = await db
    .select({ id: fileAssets.id })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(
      and(eq(fileAssets.contentHash, byteHash), ne(files.userId, userId))
    )
    .limit(1);
  return !!hit;
}

export async function createDraftFileForUser(
  userId: string,
  params: CreateDraftFileParams
): Promise<
  | { fileAssetId: string; fileSlug: string }
  | { error: string }
> {

  // Track whether the upload was adopted into a file_assets row.
  // Anything that exits without claiming the storageKey (rejected
  // upload, dedup-to-existing, thrown error) needs to delete the R2
  // object so the bucket doesn't accumulate orphans. Best-effort —
  // failed deletes are logged but don't block the response, since
  // the cleanup-orphan-uploads sweep is the safety net.
  let claimed = false;
  const releaseR2 = async () => {
    if (claimed) return;
    try {
      await deleteObject(params.storageKey);
    } catch (err) {
      logError("createDraftFileForUser.releaseR2", err);
    }
  };

  try {
    // Only accept storage keys under the user's prefix.
    if (!params.storageKey.startsWith(`uploads/${userId}/`)) {
      // Don't release: this might be someone trying to attribute
      // another user's upload to themselves. Leaving the object
      // alone avoids letting a malicious caller delete arbitrary
      // R2 keys by guessing the path.
      return { error: "Invalid storage key" };
    }

    // Sync: byte hash + cross-user byte-hash check. Geometry parse
    // happens deferred via after() below.
    const byteHash = await computeByteHashOnly(params.storageKey);

    // Self-dedupe: byte hash exact match OR (filename, size) match
    // when byte hash misses. Print is implicit ("get me a quote"),
    // so a silent reuse of the existing library row is the right
    // UX — the user doesn't care that two storage keys exist, they
    // care about getting to the quote configurator on a fileAsset.
    const existing = await findExistingSameUserAsset({
      userId,
      byteHash,
      originalFilename: params.originalFilename,
      fileSize: params.fileSize,
    });
    if (existing) {
      await releaseR2();
      return { fileAssetId: existing.assetId, fileSlug: existing.fileSlug };
    }

    if (byteHash && (await checkByteHashCollision(byteHash, userId))) {
      await releaseR2();
      return {
        error:
          "This file has already been listed by another creator. Re-uploading others' files is not permitted.",
      };
    }

    const name =
      params.displayName?.trim() || deriveListingName(params.originalFilename);
    const slug = buildListingSlug(name, nanoid(6));

    const [pref] = await db
      .select({ defaultUploadVisibility: users.defaultUploadVisibility })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const visibility = pref?.defaultUploadVisibility ?? "private";

    const [file] = await db
      .insert(files)
      .values({
        userId,
        name,
        slug,
        price: 0,
        license: "cc_by",
        // Default visibility comes from the user's settings (default
        // "private"). The user uploaded this to print, not to
        // publish — but power users can flip the default to "public"
        // from /dashboard/settings if they want every print upload
        // to also appear on their profile. Status follows visibility:
        // "private" → "draft", "public" → "published".
        status: visibility === "public" ? "published" : "draft",
        visibility,
        source: params.source ?? "upload",
      })
      .returning();

    const [asset] = await db
      .insert(fileAssets)
      .values({
        fileId: file.id,
        storageKey: params.storageKey,
        originalFilename: params.originalFilename,
        format: params.format,
        fileUnit: params.fileUnit ?? "mm",
        fileSize: params.fileSize,
        contentHash: byteHash ?? null,
      })
      .returning({ id: fileAssets.id });

    claimed = true;

    // Defer the geometry parse + cross-user geometry-hash check.
    after(() =>
      fingerprintAndPersistAsset({
        assetId: asset.id,
        fileId: file.id,
        ownerUserId: userId,
        storageKey: params.storageKey,
        format: params.format as MeshFormat,
        fileUnit: params.fileUnit ?? "mm",
      })
    );

    revalidatePath("/dashboard/uploads");
    return { fileAssetId: asset.id, fileSlug: file.slug };
  } catch (error) {
    logError("createDraftFileForUser", error);
    await releaseR2();
    return { error: "Failed to prepare file for printing. Please try again." };
  }
}

