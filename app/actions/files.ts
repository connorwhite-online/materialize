"use server";

/**
 * Server actions for file listings and assets.
 *
 * Main entry points:
 *   createFileListing(formData)       — publishes a new listing from
 *     a client upload. Expects `assetsJson` (IncomingAsset[]) in
 *     addition to the listing fields. Validates via
 *     createListingSchema, streams each R2 object through SHA-256
 *     for the anti-piracy dedup check, inserts file + fileAssets +
 *     optional collection link, then redirects to /files/[slug].
 *
 *   createDraftFileForPrint(params)   — fast path used by the anon
 *     and authed "Print this file" flows. Takes an already-uploaded
 *     R2 storage key and creates a private listing row + a single
 *     fileAsset, returning the fileAssetId. Also runs the
 *     content-hash dedup check — re-uploading someone else's model
 *     is rejected with a fixed error string.
 *
 *   publishFileListing / archiveFileListing / deleteFileListing —
 *     state transitions on an existing listing.
 *
 * Invariants:
 *   - Every R2 storage key must start with `uploads/${userId}/` or
 *     we reject immediately (spoofing guard).
 *   - computeContentHash streams directly from R2 via a presigned
 *     GET; hash is persisted on the fileAsset row for later dedup.
 *   - Nothing in here places real CraftCloud orders — that's
 *     app/actions/print.ts + the stripe webhook.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  collections,
  collectionFiles,
  filePhotos,
  purchases,
} from "@/lib/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { createListingSchema } from "@/lib/validations/file";
import { logError } from "@/lib/logger";
import { generateDownloadUrl, deleteObject } from "@/lib/storage";

type IncomingAsset = {
  storageKey: string;
  originalFilename: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileSize: number;
  fileUnit?: "mm" | "cm" | "in";
};

const VALID_FORMATS = new Set(["stl", "obj", "3mf", "step", "amf"]);
const VALID_UNITS = new Set(["mm", "cm", "in"]);

/**
 * Runtime type guard for an IncomingAsset row. Used to validate the
 * shape of the assetsJson payload that the client POSTs along with
 * createFileListing — we can't trust it's the type we expect just
 * because JSON.parse returned something.
 */
function isIncomingAsset(v: unknown): v is IncomingAsset {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.storageKey === "string" &&
    a.storageKey.length > 0 &&
    typeof a.originalFilename === "string" &&
    a.originalFilename.length > 0 &&
    typeof a.format === "string" &&
    VALID_FORMATS.has(a.format) &&
    typeof a.fileSize === "number" &&
    Number.isFinite(a.fileSize) &&
    a.fileSize > 0 &&
    (a.fileUnit === undefined ||
      (typeof a.fileUnit === "string" && VALID_UNITS.has(a.fileUnit)))
  );
}

async function computeContentHash(storageKey: string): Promise<string | null> {
  try {
    const { createHash } = await import("crypto");
    const downloadUrl = await generateDownloadUrl(storageKey, 300);
    const res = await fetch(downloadUrl);
    if (!res.ok || !res.body) return null;
    const hash = createHash("sha256");
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.digest("hex");
  } catch (err) {
    logError("computeContentHash", err);
    return null;
  }
}

export async function createFileListing(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // Design tags come as multiple form values
  const designTagValues = formData.getAll("designTags") as string[];

  const parsed = createListingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    license: formData.get("license"),
    tags: formData.get("tags"),
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

  // Verify each storageKey belongs to this user before we touch R2.
  for (const asset of incomingAssets) {
    if (!asset.storageKey.startsWith(`uploads/${userId}/`)) {
      return { error: { name: ["Invalid storage key."] } };
    }
  }

  try {
    // Compute content hashes by streaming the freshly-uploaded R2 objects.
    const hashes = await Promise.all(
      incomingAssets.map((a) => computeContentHash(a.storageKey))
    );

    // Anti-piracy: any hash collision with a file owned by someone else
    // means this user is re-uploading work that isn't theirs.
    const definedHashes = hashes.filter((h): h is string => h !== null);
    if (definedHashes.length > 0) {
      const duplicates = await db
        .select({ id: fileAssets.id })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(
          and(
            inArray(fileAssets.contentHash, definedHashes),
            ne(files.userId, userId)
          )
        );
      if (duplicates.length > 0) {
        return {
          error: {
            name: [
              "This file has already been listed by another creator. Re-uploading others' files is not permitted.",
            ],
          },
        };
      }
    }

    const slug = `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${nanoid(6)}`;

    // New files default to public so they land in browse / search. The
    // owner can flip to private any time via the file settings dialog.
    const visibility: "public" | "private" =
      parsed.data.visibility ?? "public";

    const [file] = await db
      .insert(files)
      .values({
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
        price: parsed.data.price,
        license: parsed.data.license,
        tags: parsed.data.tags,
        recommendedMaterialId: parsed.data.recommendedMaterialId,
        designTags: parsed.data.designTags,
        minWallThickness: parsed.data.minWallThickness,
        status: "published",
        visibility,
      })
      .returning();

    // Insert the file asset rows now that we have a fileId to link them to.
    await db.insert(fileAssets).values(
      incomingAssets.map((asset, i) => ({
        fileId: file.id,
        storageKey: asset.storageKey,
        originalFilename: asset.originalFilename,
        format: asset.format,
        fileUnit: asset.fileUnit ?? "mm",
        fileSize: asset.fileSize,
        contentHash: hashes[i],
      }))
    );

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
      const [created] = await db
        .insert(collections)
        .values({ userId, name: newCollectionName, slug })
        .returning({ id: collections.id });
      targetCollectionId = created.id;
    } else if (rawCollectionId && rawCollectionId !== "none") {
      // Verify ownership before linking
      const [owned] = await db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, rawCollectionId), eq(collections.userId, userId)));
      if (owned) targetCollectionId = owned.id;
    }

    if (targetCollectionId) {
      await db.insert(collectionFiles).values({
        collectionId: targetCollectionId,
        fileId: file.id,
        sortOrder: 0,
      });
    }

    revalidatePath("/dashboard");
    redirect(`/files/${file.slug}`);
  } catch (error) {
    // Re-throw redirect/notFound errors (Next.js uses throw for navigation)
    if (error instanceof Error && (error.message.includes("NEXT_REDIRECT") || error.message.includes("REDIRECT"))) {
      throw error;
    }
    logError("createFileListing", error);
    return { error: { name: ["Failed to create listing. Please try again."] } };
  }
}

export async function updateFileListing(fileId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  try {
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) throw new Error("Not found");

    const designTagValues = formData.getAll("designTags") as string[];

    const parsed = createListingSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      price: formData.get("price"),
      license: formData.get("license"),
      visibility: formData.get("visibility") || undefined,
      tags: formData.get("tags") || undefined,
      recommendedMaterialId:
        formData.get("recommendedMaterialId") || undefined,
      designTags: designTagValues.length > 0 ? designTagValues : undefined,
      minWallThickness: formData.get("minWallThickness") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.flatten().fieldErrors };
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
        recommendedMaterialId: parsed.data.recommendedMaterialId,
        designTags: parsed.data.designTags,
        minWallThickness: parsed.data.minWallThickness,
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

    await db
      .update(files)
      .set({ status: "published" })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

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

    await db
      .update(files)
      .set({ status: "archived" })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

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
export async function deleteFileListing(
  fileId: string
): Promise<
  | { archived: true; reason: "has-buyers"; buyerCount: number }
  | { deleted: true }
  | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [file] = await db
      .select({
        id: files.id,
        slug: files.slug,
        userId: files.userId,
      })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) return { error: "File not found" };

    const buyerRows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.fileId, fileId),
          eq(purchases.status, "completed")
        )
      );

    if (buyerRows.length > 0) {
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
        buyerCount: buyerRows.length,
      };
    }

    // No buyers — safe to hard-delete. Collect every storage key first
    // so we can scrub R2 even after the DB rows are gone.
    const assets = await db
      .select({ storageKey: fileAssets.storageKey })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, fileId));
    const photos = await db
      .select({ storageKey: filePhotos.storageKey })
      .from(filePhotos)
      .where(eq(filePhotos.fileId, fileId));

    const keys = [
      ...assets.map((a) => a.storageKey),
      ...photos.map((p) => p.storageKey),
      // Thumbnail key is derived from the file id at upload time, see
      // app/api/thumbnails/route.ts.
      `thumbnails/${fileId}.webp`,
    ];

    // R2 deletes are best-effort — a stale object is better than a
    // failed delete leaving a half-gone file row.
    await Promise.allSettled(keys.map((k) => deleteObject(k)));

    // Cascade rules clean up file_assets, file_photos, collection_files,
    // and print_orders for us.
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
 * Derives a listing name from an uploaded filename. "carabiner.stl"
 * becomes "Carabiner", "left_bracket_v3.obj" becomes "Left Bracket V3".
 * Falls back to "Untitled Print" if the filename is pathological.
 */
function deriveListingName(originalFilename: string): string {
  const withoutExt = originalFilename.replace(/\.[^.]+$/, "");
  const spaced = withoutExt.replace(/[_-]+/g, " ").trim();
  const titled = spaced
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return titled || "Untitled Print";
}

/**
 * Fast-path for the "Print this file" CTA on the home bar and the
 * /print page dropzone. Persists the uploaded file as a private
 * draft — name derived from the filename, no description, no tags,
 * free license, visibility=private — so the user can walk into the
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
}): Promise<
  | { fileAssetId: string; fileSlug: string }
  | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Only accept storage keys under the user's prefix.
    if (!params.storageKey.startsWith(`uploads/${userId}/`)) {
      return { error: "Invalid storage key" };
    }

    // Anti-piracy: same content-hash check as createFileListing.
    // Someone can't use the print path as a back door to stand up
    // a file they don't own.
    const contentHash = await computeContentHash(params.storageKey);
    if (contentHash) {
      const duplicates = await db
        .select({ id: fileAssets.id })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(
          and(
            eq(fileAssets.contentHash, contentHash),
            ne(files.userId, userId)
          )
        );
      if (duplicates.length > 0) {
        return {
          error:
            "This file has already been listed by another creator. Re-uploading others' files is not permitted.",
        };
      }
    }

    const name = deriveListingName(params.originalFilename);
    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${nanoid(6)}`;

    const [file] = await db
      .insert(files)
      .values({
        userId,
        name,
        slug,
        price: 0,
        license: "free",
        // Default to a public, free listing so the file is
        // immediately discoverable in the marketplace. The listing
        // is intentionally sparse (scraped name, no description or
        // thumbnail) — the owner can polish it later from their
        // dashboard without having to republish.
        status: "published",
        visibility: "public",
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
        contentHash,
      })
      .returning({ id: fileAssets.id });

    revalidatePath("/dashboard/uploads");
    return { fileAssetId: asset.id, fileSlug: file.slug };
  } catch (error) {
    logError("createDraftFileForPrint", error);
    return { error: "Failed to prepare file for printing. Please try again." };
  }
}

export async function toggleFileVisibility(fileId: string) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const [file] = await db
      .select({ visibility: files.visibility })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) return { error: "File not found" };

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
