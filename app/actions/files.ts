"use server";

/**
 * Server actions for file listings and assets.
 *
 * Main entry points:
 *   createFileListing(formData)       — publishes a new listing from
 *     a client upload. Expects `assetsJson` (IncomingAsset[]) in
 *     addition to the listing fields. Sync work: validate, byte-hash
 *     each asset, hard-block on cross-user byte-hash collision,
 *     insert files + fileAssets + optional collection link, then
 *     redirect. Async work (via Next 16 `after()`): parse the mesh,
 *     compute geometry hash + coarse fingerprint + bbox/volume/tri
 *     stats, UPDATE the asset row, and run the cross-user geometry-
 *     hash check; on a hit, the listing auto-archives with a
 *     flagged_reason / flagged_at / flagged_against_file_id audit
 *     trail (owner can dispute later).
 *
 *   createDraftFileForPrint(params)   — fast path used by the anon
 *     and authed "Print this file" flows. Takes an already-uploaded
 *     R2 storage key and creates a private listing row + a single
 *     fileAsset, returning the fileAssetId. Same sync/async split
 *     as createFileListing.
 *
 *   publishFileListing / archiveFileListing / deleteFileListing —
 *     state transitions on an existing listing.
 *
 * Invariants:
 *   - Every R2 storage key must start with `uploads/${userId}/` or
 *     we reject immediately (spoofing guard).
 *   - The byte hash is computed inline on the upload's hot path and
 *     persisted with the row before the response returns; the
 *     geometry / coarse / stats columns fill in over the next 1-3s
 *     of after() work and may be NULL transiently.
 *   - Nothing in here places real CraftCloud orders — that's
 *     app/actions/print.ts + the stripe webhook.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  collections,
  collectionItems,
  filePhotos,
  purchases,
  projectFiles,
  projects,
  cartItems,
  printOrders,
  printOrderItems,
  users,
  ownershipClaimIntents,
  disputes,
} from "@/lib/db/schema";
import { eq, and, gt, inArray, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { createListingSchema } from "@/lib/validations/file";
import { MAX_PROJECT_FILES } from "@/lib/validations/project";
import {
  canWriteCollection,
  canWriteFile,
  canWriteProject,
  resolveOwnerForCreate,
} from "@/lib/authorization";
import {
  isIncomingAsset,
  type IncomingAsset,
} from "@/lib/validations/incoming-asset";
import { deriveListingName, buildListingSlug } from "@/lib/filenames";
import { logError, isRedirectError } from "@/lib/logger";
import {
  generateDownloadUrl,
  deleteObject,
  copyObject,
} from "@/lib/storage";
import { type MeshFormat } from "@/lib/hashing/mesh-fingerprint";
import {
  fingerprintAndPersistAsset,
  checkByteHashCollisionBatch,
  findExistingSameUserAssetsBatch,
  type DuplicateFileSummary,
} from "@/lib/hashing/fingerprint-asset";
import { after } from "next/server";

function duplicateUploadResult(
  claimIntentId: string,
  existing: DuplicateFileSummary
) {
  return {
    duplicate: {
      claimIntentId,
      file: {
        name: existing.fileName,
        slug: existing.fileSlug,
        thumbnailUrl: existing.thumbnailUrl,
      },
      owner: {
        username: existing.ownerUsername,
        displayName: existing.ownerDisplayName,
        avatarUrl: existing.ownerAvatarUrl,
      },
    },
  } as const;
}

// Sync helper: stream R2 -> SHA-256 of raw bytes. This is the only
// fingerprint work we do on the upload's hot path now — the geometry
// parse + canonical-sort happens deferred via fingerprintAndPersistAsset.
// Streaming hash is bandwidth-bound, ~500ms for a 50 MB file.
async function computeByteHashOnly(
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

export async function createFileListing(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // Optional owner attribution — if the upload form's owner picker
  // selected an organization, we record this row as org-owned so
  // every member can read/write it. Empty/missing means "personal".
  // resolveOwnerForCreate re-verifies viewer membership server-side
  // so a tampered hidden input can't plant content under an org the
  // user isn't actually in.
  const rawOrgIdForCreate = formData.get("organizationId");
  const requestedOrgId =
    typeof rawOrgIdForCreate === "string" && rawOrgIdForCreate.length > 0
      ? rawOrgIdForCreate
      : null;
  const ownerResolution = await resolveOwnerForCreate(userId, requestedOrgId);
  if (!ownerResolution.ok) {
    return { error: { name: ["You're not a member of that organization."] } };
  }
  const organizationId = ownerResolution.organizationId;

  // Design tags come as multiple form values
  const designTagValues = formData.getAll("designTags") as string[];

  const parsed = createListingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    license: formData.get("license"),
    tags: formData.get("tags"),
    category: formData.get("category") || undefined,
    recommendedMaterialId: formData.get("recommendedMaterialId") || undefined,
    designTags: designTagValues.length > 0 ? designTagValues : undefined,
    minWallThickness: formData.get("minWallThickness") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  // Decode the uploaded assets payload (assets are uploaded to R2 by the
  // client immediately before this action runs, so the storageKeys exist
  // but no DB rows do yet). Runtime-validate every row — we can't trust
  // JSON.parse to give us the IncomingAsset shape.
  let incomingAssets: IncomingAsset[] = [];
  try {
    const assetsRaw = formData.get("assetsJson");
    if (typeof assetsRaw === "string" && assetsRaw.length > 0) {
      const decoded = JSON.parse(assetsRaw);
      if (!Array.isArray(decoded)) {
        logError("createFileListing.parseAssets", {
          reason: "not-an-array",
          typeofDecoded: typeof decoded,
        });
        return { error: { name: ["Invalid asset payload."] } };
      }
      if (!decoded.every(isIncomingAsset)) {
        logError("createFileListing.parseAssets", {
          reason: "bad-row-shape",
          count: decoded.length,
        });
        return { error: { name: ["Invalid asset payload."] } };
      }
      incomingAssets = decoded;
    }
  } catch (err) {
    logError("createFileListing.parseAssets", err);
    return { error: { name: ["Invalid asset payload."] } };
  }

  if (incomingAssets.length === 0) {
    return { error: { name: ["No file attached. Please re-upload."] } };
  }
  if (incomingAssets.length > MAX_PROJECT_FILES) {
    return {
      error: {
        name: [`A listing can contain at most ${MAX_PROJECT_FILES} files.`],
      },
    };
  }
  if (
    new Set(incomingAssets.map((asset) => asset.storageKey)).size !==
    incomingAssets.length
  ) {
    return { error: { name: ["The same uploaded file was attached more than once."] } };
  }

  // Verify each storageKey belongs to this user before we touch R2.
  for (const asset of incomingAssets) {
    if (!asset.storageKey.startsWith(`uploads/${userId}/`)) {
      return { error: { name: ["Invalid storage key."] } };
    }
  }

  try {
    // Sync: byte hash + cross-user byte-hash collision check. The
    // expensive geometry parse is deferred via after() below.
    const byteHashes = await Promise.all(
      incomingAssets.map((a) => computeByteHashOnly(a.storageKey))
    );

    // Run the two collision lookups for the whole batch as two
    // queries total (regardless of asset count) instead of up to 2N
    // per-asset round trips: one inArray(contentHash, ...) query for
    // cross-user collisions, one combined query for same-user dedup
    // (byte-hash match unioned with filename+size fallback matches).
    // See lib/hashing/fingerprint-asset.ts for the batched helpers.
    //
    // To preserve the original serial-order error semantics (report
    // the first listed asset's failure first), we replay each
    // asset's per-asset priority (cross-user check, then same-user
    // check) against the batched results in memory, then walk the
    // array in order for the first non-null finding.
    type CollisionFinding =
      | {
          kind: "cross-user";
          hash: string;
          assetIndex: number;
          existing: DuplicateFileSummary;
        }
      | { kind: "same-user"; fileName: string; fileSlug: string };
    const nonNullHashes = byteHashes.filter((h): h is string => !!h);
    const [crossUserHashes, sameUserMatches] = await Promise.all([
      checkByteHashCollisionBatch(nonNullHashes, userId, organizationId),
      findExistingSameUserAssetsBatch(
        userId,
        incomingAssets.map((asset, i) => ({
          byteHash: byteHashes[i],
          originalFilename: asset.originalFilename,
          fileSize: asset.fileSize,
        })),
        organizationId
      ),
    ]);
    const findings: Array<CollisionFinding | null> = incomingAssets.map(
      (asset, i): CollisionFinding | null => {
        const hash = byteHashes[i];
        const existingCrossUser = hash
          ? crossUserHashes.get(hash)
          : undefined;
        if (hash && existingCrossUser) {
          return {
            kind: "cross-user",
            hash,
            assetIndex: i,
            existing: existingCrossUser,
          };
        }
        const existing =
          (hash && sameUserMatches.byHash.get(hash)) ||
          (asset.originalFilename && asset.fileSize > 0
            ? sameUserMatches.byNameSize.get(
                `${asset.originalFilename}::${asset.fileSize}`
              )
            : undefined);
        if (existing) {
          return {
            kind: "same-user",
            fileName: existing.fileName,
            fileSlug: existing.fileSlug,
          };
        }
        return null;
      }
    );
    const firstFinding = findings.find((f) => f !== null);
    if (firstFinding?.kind === "cross-user") {
      const uploadedAsset = incomingAssets[firstFinding.assetIndex];
      const [reusableIntent] = await db
        .select({ id: ownershipClaimIntents.id })
        .from(ownershipClaimIntents)
        .leftJoin(
          disputes,
          eq(disputes.claimIntentId, ownershipClaimIntents.id)
        )
        .where(
          and(
            eq(ownershipClaimIntents.raisedByUserId, userId),
            eq(
              ownershipClaimIntents.existingFileId,
              firstFinding.existing.fileId
            ),
            eq(ownershipClaimIntents.contentHash, firstFinding.hash),
            gt(ownershipClaimIntents.expiresAt, new Date()),
            isNull(disputes.id)
          )
        )
        .limit(1);
      if (reusableIntent) {
        await deleteObject(uploadedAsset.storageKey).catch((error) => {
          logError("createFileListing.deleteRepeatedDuplicate", error);
        });
        return duplicateUploadResult(
          reusableIntent.id,
          firstFinding.existing
        );
      }

      // Freeze the bytes at a fresh server-only key. The browser's original
      // presigned PUT remains valid briefly and must not be the evidence an
      // operator later reviews.
      const evidenceStorageKey =
        `uploads/${userId}/ownership-evidence/${nanoid()}`;
      await copyObject(uploadedAsset.storageKey, evidenceStorageKey);
      const evidenceHash = await computeByteHashOnly(evidenceStorageKey);
      if (evidenceHash !== firstFinding.hash) {
        await deleteObject(evidenceStorageKey).catch(() => undefined);
        return {
          error: {
            name: ["The uploaded file changed during verification. Please upload it again."],
          },
        };
      }
      const [claimIntent] = await db
        .insert(ownershipClaimIntents)
        .values({
          raisedByUserId: userId,
          existingFileId: firstFinding.existing.fileId,
          storageKey: evidenceStorageKey,
          originalFilename: uploadedAsset.originalFilename,
          fileSize: uploadedAsset.fileSize,
          contentHash: firstFinding.hash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: ownershipClaimIntents.id });
      await deleteObject(uploadedAsset.storageKey).catch((error) => {
        logError("createFileListing.deleteDuplicateSource", error);
      });
      return duplicateUploadResult(claimIntent.id, firstFinding.existing);
    }
    if (firstFinding?.kind === "same-user") {
      return {
        error: {
          name: [
            `You've already uploaded this file as "${firstFinding.fileName}". Edit that listing instead at /files/${firstFinding.fileSlug}.`,
          ],
        },
      };
    }

    const slug = buildListingSlug(parsed.data.name, nanoid(6));

    // New files default to public so they land in browse / search. The
    // owner can flip to private any time via the file settings dialog.
    const visibility: "public" | "private" =
      parsed.data.visibility ?? "public";

    const [file] = await db
      .insert(files)
      .values({
        userId,
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
        price: parsed.data.price,
        license: parsed.data.license,
        tags: parsed.data.tags,
        category: parsed.data.category,
        recommendedMaterialId: parsed.data.recommendedMaterialId,
        designTags: parsed.data.designTags,
        minWallThickness: parsed.data.minWallThickness,
        status: "published",
        visibility,
      })
      .returning();

    // Insert with byte hash now; geometry hash + stats fill in async.
    const insertedAssets = await db
      .insert(fileAssets)
      .values(
        incomingAssets.map((asset, i) => ({
          fileId: file.id,
          storageKey: asset.storageKey,
          originalFilename: asset.originalFilename,
          format: asset.format,
          fileUnit: asset.fileUnit ?? "mm",
          fileSize: asset.fileSize,
          contentHash: byteHashes[i] ?? null,
        }))
      )
      .returning({ id: fileAssets.id });

    // Defer the geometry parse + cross-user geometry-hash check. If
    // it finds a collision, the listing gets auto-archived with a
    // flag — see fingerprintAndPersistAsset.
    for (let i = 0; i < insertedAssets.length; i++) {
      const a = incomingAssets[i];
      const inserted = insertedAssets[i];
      after(() =>
        fingerprintAndPersistAsset({
          assetId: inserted.id,
          fileId: file.id,
          ownerUserId: userId,
          storageKey: a.storageKey,
          format: a.format as MeshFormat,
          fileUnit: a.fileUnit ?? "mm",
        })
      );
    }

    // Optional: add to an existing collection or create a new one
    const rawCollectionId = (formData.get("collectionId") as string | null) || "";
    const newCollectionName = (
      (formData.get("newCollectionName") as string | null) || ""
    ).trim();

    let targetCollectionId: string | null = null;
    if (rawCollectionId === "__new__" && newCollectionName) {
      const slug = `${newCollectionName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${nanoid(6)}`;
      // Inherit the file's owner — an org-attributed upload that
      // creates a brand-new collection puts that collection under the
      // same org. Otherwise it's personal.
      const [created] = await db
        .insert(collections)
        .values({ userId, organizationId, name: newCollectionName, slug })
        .returning({ id: collections.id });
      targetCollectionId = created.id;
    } else if (rawCollectionId && rawCollectionId !== "none") {
      // Verify the viewer can write to this collection. Covers both
      // personal collections (user-owned) and collections owned by an
      // org the viewer belongs to — the unified check lives in
      // lib/authorization.ts.
      const check = await canWriteCollection(userId, rawCollectionId);
      if (check.ok) targetCollectionId = check.resource.id;
    }

    if (targetCollectionId) {
      await db.insert(collectionItems).values({
        collectionId: targetCollectionId,
        fileId: file.id,
        sortOrder: 0,
      });
    }

    // Optional: attach the new file to a project bundle. Used by the
    // "Project" picker on the upload form and the project page's "Add
    // files" combo modal (which uploads straight into the bundle).
    // When attached we redirect back to the project instead of the
    // file so the creator lands where they started.
    const rawProjectId = (formData.get("projectId") as string | null) || "";
    let attachedProjectSlug: string | null = null;
    if (rawProjectId && rawProjectId !== "none") {
      const access = await canWriteProject(userId, rawProjectId);
      if (access.ok) {
        const existing = await db
          .select({ fileId: projectFiles.fileId })
          .from(projectFiles)
          .where(eq(projectFiles.projectId, rawProjectId));
        if (existing.length < MAX_PROJECT_FILES) {
          await db
            .insert(projectFiles)
            .values({
              projectId: rawProjectId,
              fileId: file.id,
              position: existing.length,
            })
            .onConflictDoNothing({
              target: [projectFiles.projectId, projectFiles.fileId],
            });
        }
        revalidatePath(`/projects/${access.resource.slug}`);
        attachedProjectSlug = access.resource.slug;
      }
    }

    revalidatePath("/dashboard");
    redirect(
      attachedProjectSlug
        ? `/projects/${attachedProjectSlug}`
        : `/files/${file.slug}`
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logError("createFileListing", error);
    return { error: { name: ["Failed to create listing. Please try again."] } };
  }
}

export async function updateFileListing(fileId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    // Unified write check — passes for the personal owner OR any
    // member of the org that owns the file. Same shape will absorb a
    // project_collaborators check later without touching this caller.
    const access = await canWriteFile(userId, fileId);
    if (!access.ok) throw new Error("Not found");
    const file = access.resource;

    const designTagValues = formData.getAll("designTags") as string[];

    const parsed = createListingSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      price: formData.get("price"),
      license: formData.get("license"),
      visibility: formData.get("visibility") || undefined,
      tags: formData.get("tags") || undefined,
      category: formData.get("category") || undefined,
      recommendedMaterialId:
        formData.get("recommendedMaterialId") || undefined,
      recommendedCcMaterialId:
        formData.get("recommendedCcMaterialId") || undefined,
      recommendedCcFinishGroupId:
        formData.get("recommendedCcFinishGroupId") || undefined,
      designTags: designTagValues.length > 0 ? designTagValues : undefined,
      minWallThickness: formData.get("minWallThickness") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
    }

    // Optional cover override — points at one of THIS file's
    // curator photos. Empty / missing means "use the auto-captured
    // thumbnail" (column reset to null). Validate the photo really
    // belongs to this file so a stray uuid from another listing
    // can't be aliased in.
    const rawCoverPhotoId = formData.get("coverPhotoId");
    let nextCoverPhotoId: string | null = null;
    if (typeof rawCoverPhotoId === "string" && rawCoverPhotoId !== "") {
      const [cover] = await db
        .select({ id: filePhotos.id })
        .from(filePhotos)
        .where(
          and(
            eq(filePhotos.id, rawCoverPhotoId),
            eq(filePhotos.fileId, fileId),
            eq(filePhotos.kind, "creator")
          )
        );
      if (!cover) {
        return {
          error: {
            coverPhotoId: ["Cover photo doesn't belong to this file."],
          },
        };
      }
      nextCoverPhotoId = cover.id;
    }

    await db
      .update(files)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        price: parsed.data.price,
        license: parsed.data.license,
        visibility: parsed.data.visibility ?? file.visibility,
        tags: parsed.data.tags,
        category: parsed.data.category ?? null,
        recommendedMaterialId: parsed.data.recommendedMaterialId,
        recommendedCcMaterialId: parsed.data.recommendedCcMaterialId,
        recommendedCcFinishGroupId: parsed.data.recommendedCcFinishGroupId,
        designTags: parsed.data.designTags,
        minWallThickness: parsed.data.minWallThickness,
        coverPhotoId: nextCoverPhotoId,
      })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
    revalidatePath(`/files/${file.slug}`);
    return { success: true };
  } catch (error) {
    logError("updateFileListing", error);
    return { error: { name: ["Failed to update listing. Please try again."] } };
  }
}

export async function publishFileListing(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteFile(userId, fileId);
    if (!access.ok) return;

    await db
      .update(files)
      .set({ status: "published" })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
  } catch (error) {
    logError("publishFileListing", error);
  }
}

export async function archiveFileListing(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteFile(userId, fileId);
    if (!access.ok) return;

    await db
      .update(files)
      .set({ status: "archived" })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
  } catch (error) {
    logError("archiveFileListing", error);
  }
}

/**
 * Delete a file the owner controls.
 *
 * If anyone has purchased the file we soft-delete instead of hard-delete:
 * the file row stays, status flips to `archived`, visibility flips to
 * `private`, and storage is preserved so buyers retain access. Hard
 * delete (DB row + R2 objects) only happens when there are no buyers,
 * since cascade rules would otherwise revoke purchased downloads.
 *
 * Caller is expected to confirm intent twice — this action does no
 * additional confirmation of its own.
 */
/** Print order statuses where the order is still mid-flow — paid or
 * about to be paid, but not yet received/refunded/cancelled. A file
 * referenced by an active row in either of these states must not be
 * hard-deleted: cascading the fileAsset away would silently drop the
 * line item from a Stripe session, the buyer's library, or a
 * production-side order at CraftCloud.
 *
 * Keep this set in sync with the status machine in AGENTS.md
 * (CON-153). Any new status that represents a charged-or-about-to-be-
 * charged order must be added here.
 *
 * Includes charged-before-fulfillment statuses (CON-164):
 *   - awaiting_agent_approval: agent order created, policy eval in flight
 *   - auto_approved: off-session PI already charged; CraftCloud placement pending
 *   - awaiting_production_payment: two-step fee hold active; deleting
 *     the file would break resumption and refund context */
const ACTIVE_ORDER_STATUSES = [
  "cart_created",
  "awaiting_agent_approval",
  "auto_approved",
  "awaiting_production_payment",
  "ordered",
  "in_production",
  "shipped",
] as const;

export async function deleteFileListing(
  fileId: string
): Promise<
  | { archived: true; reason: "has-buyers" | "in-flight"; buyerCount: number }
  | { deleted: true }
  | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const access = await canWriteFile(userId, fileId);
    if (!access.ok) return { error: "File not found" };
    const file = access.resource;

    const directBuyers = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.fileId, fileId),
          eq(purchases.status, "completed")
        )
      );

    // Indirect entitlement: anyone who bought a project containing
    // this file also owns it. Hard-deleting would silently revoke
    // their access, so we soft-archive instead.
    const projectBuyers = await db
      .select({ id: purchases.id })
      .from(purchases)
      .innerJoin(projects, eq(purchases.projectId, projects.id))
      .innerJoin(projectFiles, eq(projectFiles.projectId, projects.id))
      .where(
        and(
          eq(projectFiles.fileId, fileId),
          eq(purchases.status, "completed")
        )
      );

    const totalBuyers = directBuyers.length + projectBuyers.length;
    if (totalBuyers > 0) {
      await db
        .update(files)
        .set({ status: "archived", visibility: "private" })
        .where(eq(files.id, fileId));
      revalidatePath(`/files/${file.slug}`);
      revalidatePath("/files");
      revalidatePath("/dashboard/uploads");
      return {
        archived: true,
        reason: "has-buyers",
        buyerCount: totalBuyers,
      };
    }

    // No completed purchases, but the file might still be referenced by
    // someone's open cart or by a print order that hasn't shipped yet.
    // Cascading those rows away would silently drop line items from a
    // pending Stripe session or break a placed CraftCloud order. Soft-
    // archive in that case too — once the order completes (or the user
    // empties their cart), a re-attempt will hard-delete cleanly.
    const fileAssetIds = (
      await db
        .select({ id: fileAssets.id })
        .from(fileAssets)
        .where(eq(fileAssets.fileId, fileId))
    ).map((r) => r.id);

    if (fileAssetIds.length > 0) {
      const [activeCartItems, activeOrderItems, activeSingleOrders] =
        await Promise.all([
          db
            .select({ id: cartItems.id })
            .from(cartItems)
            .where(inArray(cartItems.fileAssetId, fileAssetIds))
            .limit(1),
          db
            .select({ id: printOrderItems.id })
            .from(printOrderItems)
            .innerJoin(
              printOrders,
              eq(printOrderItems.printOrderId, printOrders.id)
            )
            .where(
              and(
                inArray(printOrderItems.fileAssetId, fileAssetIds),
                inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
              )
            )
            .limit(1),
          db
            .select({ id: printOrders.id })
            .from(printOrders)
            .where(
              and(
                inArray(printOrders.fileAssetId, fileAssetIds),
                inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
              )
            )
            .limit(1),
        ]);

      const inFlight =
        activeCartItems.length +
        activeOrderItems.length +
        activeSingleOrders.length;
      if (inFlight > 0) {
        await db
          .update(files)
          .set({ status: "archived", visibility: "private" })
          .where(eq(files.id, fileId));
        revalidatePath(`/files/${file.slug}`);
        revalidatePath("/files");
        revalidatePath("/dashboard/uploads");
        return {
          archived: true,
          reason: "in-flight",
          buyerCount: inFlight,
        };
      }
    }
    // No buyers — safe to hard-delete. Collect every storage key first
    // so we can scrub R2 even after the DB rows are gone.
    const assets = await db
      .select({
        storageKey: fileAssets.storageKey,
        // Editable STEP source (MTR-196) rides beside the mesh — scrub it
        // with the STL so a deleted CAD file leaves no orphaned .step in R2.
        stepStorageKey: fileAssets.stepStorageKey,
      })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, fileId));
    const photos = await db
      .select({ storageKey: filePhotos.storageKey })
      .from(filePhotos)
      .where(eq(filePhotos.fileId, fileId));

    const keys = [
      ...assets.map((a) => a.storageKey),
      ...assets
        .map((a) => a.stepStorageKey)
        .filter((k): k is string => !!k),
      ...photos.map((p) => p.storageKey),
      // Thumbnail key is derived from the file id at upload time, see
      // app/api/thumbnails/route.ts.
      `thumbnails/${fileId}.webp`,
    ];

    // R2 deletes are best-effort — a stale object is better than a
    // failed delete leaving a half-gone file row. Still log
    // rejections (with the failing key) so a permission drift or R2
    // outage leaves a record instead of a silent orphan.
    const deleteResults = await Promise.allSettled(
      keys.map((k) => deleteObject(k))
    );
    deleteResults.forEach((r, i) => {
      if (r.status === "rejected") {
        logError("deleteFileListing.r2", { key: keys[i], error: r.reason });
      }
    });

    // Cascade rules clean up file_assets, file_photos, collection_items,
    // project_files, and print_orders for us.
    await db.delete(files).where(eq(files.id, fileId));

    revalidatePath(`/files/${file.slug}`);
    revalidatePath("/files");
    revalidatePath("/dashboard/uploads");
    return { deleted: true };
  } catch (error) {
    logError("deleteFileListing", error);
    return { error: "Failed to delete file" };
  }
}

/**
 * Fast-path for the "Print this file" CTA on the home bar and the
 * /print page dropzone. Persists the uploaded file as a private
 * draft — name derived from the filename, no description, no tags,
 * CC-BY license (the platform default), visibility=private — so the user can walk into the
 * quote configurator immediately without filling out the full
 * listing form. They can always rename / publish it later from
 * their library via the edit dialog.
 *
 * Returns the new fileAssetId + file slug so the caller can navigate
 * straight to /print/[fileAssetId].
 */
export async function createDraftFileForPrint(params: {
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
}): Promise<
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
      logError("createDraftFileForPrint.releaseR2", err);
    }
  };

  try {
    const { userId } = await auth();
    if (!userId) {
      await releaseR2();
      return { error: "Unauthorized" };
    }

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
    logError("createDraftFileForPrint", error);
    await releaseR2();
    return { error: "Failed to prepare file for printing. Please try again." };
  }
}

export async function toggleFileVisibility(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const access = await canWriteFile(userId, fileId);
    if (!access.ok) return { error: "File not found" };
    const file = access.resource;

    const newVisibility = file.visibility === "public" ? "private" : "public";

    await db
      .update(files)
      .set({ visibility: newVisibility })
      .where(eq(files.id, fileId));

    revalidatePath("/dashboard/uploads");
    revalidatePath("/files");
    return { visibility: newVisibility };
  } catch (error) {
    logError("toggleFileVisibility", error);
    return { error: "Failed to update visibility" };
  }
}
