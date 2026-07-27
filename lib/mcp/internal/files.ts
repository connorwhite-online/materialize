import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  fileAssets,
  filePhotos,
  files,
  printOrders,
  printOrderItems,
  users,
} from "@/lib/db/schema";
import { deleteObject, generateUploadUrl, objectExists } from "@/lib/storage";
import { notUnsavedStudioDraft } from "@/lib/studio-drafts";
import { uploadModel } from "@/lib/craftcloud/client";
import { logError } from "@/lib/logger";
import { LICENSE_ENUM_VALUES, type LicenseId } from "@/lib/licenses";
import { DESIGN_TAG_OPTIONS } from "@/lib/validations/file";

const SUPPORTED_FORMATS = ["stl", "obj", "3mf", "step", "amf"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

const SUPPORTED_DESIGN_TAGS = DESIGN_TAG_OPTIONS;
export type SupportedDesignTag = (typeof SUPPORTED_DESIGN_TAGS)[number];

/**
 * Optional metadata an agent can attach to a fresh upload or apply
 * later via updateFileForUser. Mirrors the form fields on the
 * web upload sheet. All optional — defaults match the web's
 * "drop a file and save to library" path.
 */
export interface FileMetadataInput {
  name?: string;
  description?: string | null;
  /** Price in cents. 0 = free. */
  priceCents?: number;
  license?: LicenseId;
  visibility?: "public" | "private";
  /** Comma-free list — already split into tags. */
  tags?: string[];
  /** Subset of DESIGN_TAG_OPTIONS. */
  designTags?: SupportedDesignTag[];
  /** Materialize internal material id (lib/materials/), not CraftCloud. */
  recommendedMaterialId?: string;
  /** Millimeters; persisted as 0.1mm units server-side. */
  minWallThicknessMm?: number;
}

function normalizeMetadata(
  meta: FileMetadataInput | undefined
): Partial<{
  name: string;
  description: string | null;
  price: number;
  license: LicenseId;
  visibility: "public" | "private";
  tags: string[];
  designTags: string[];
  recommendedMaterialId: string | null;
  minWallThickness: number;
  status: "draft" | "published";
}> {
  if (!meta) return {};
  const out: ReturnType<typeof normalizeMetadata> = {};
  if (typeof meta.name === "string" && meta.name.trim()) {
    out.name = meta.name.trim().slice(0, 200);
  }
  if (meta.description !== undefined) {
    out.description = meta.description ? meta.description.slice(0, 5000) : null;
  }
  if (typeof meta.priceCents === "number" && meta.priceCents >= 0) {
    out.price = Math.round(meta.priceCents);
  }
  if (
    meta.license &&
    (LICENSE_ENUM_VALUES as readonly string[]).includes(meta.license)
  ) {
    out.license = meta.license;
  }
  if (meta.visibility === "public" || meta.visibility === "private") {
    out.visibility = meta.visibility;
    // Status follows visibility on first publish — public listings are
    // immediately published, private listings stay drafts.
    out.status = meta.visibility === "public" ? "published" : "draft";
  }
  if (Array.isArray(meta.tags)) {
    out.tags = meta.tags
      .map((t) => String(t).trim().slice(0, 32))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (Array.isArray(meta.designTags)) {
    out.designTags = meta.designTags.filter((t) =>
      (SUPPORTED_DESIGN_TAGS as readonly string[]).includes(t)
    );
  }
  if (meta.recommendedMaterialId !== undefined) {
    out.recommendedMaterialId = meta.recommendedMaterialId
      ? String(meta.recommendedMaterialId).slice(0, 100)
      : null;
  }
  if (
    typeof meta.minWallThicknessMm === "number" &&
    meta.minWallThicknessMm >= 0
  ) {
    out.minWallThickness = Math.round(meta.minWallThicknessMm * 10);
  }
  return out;
}

const SUPPORTED_UNITS = ["mm", "cm", "in"] as const;
export type SupportedUnit = (typeof SUPPORTED_UNITS)[number];

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function deriveFormat(filename: string): SupportedFormat | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (!ext) return null;
  return (SUPPORTED_FORMATS as readonly string[]).includes(ext)
    ? (ext as SupportedFormat)
    : null;
}

function sanitizeFilename(input: string): string {
  const stripped = input
    .replace(/^\.+/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stripped.length === 0 ? "file" : stripped;
}

export interface RequestUploadUrlInput {
  userId: string;
  filename: string;
  sizeBytes: number;
  contentType?: string;
}

export interface RequestUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  format: SupportedFormat;
  expiresAt: string;
}

export async function requestUploadUrlForUser(
  input: RequestUploadUrlInput
): Promise<RequestUploadUrlResult | { error: string }> {
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) {
    return { error: `File size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` };
  }
  const format = deriveFormat(input.filename);
  if (!format) {
    return { error: `Unsupported file format. Allowed: ${SUPPORTED_FORMATS.join(", ")}` };
  }

  const safeName = sanitizeFilename(input.filename);
  const storageKey = `uploads/${input.userId}/${nanoid()}/${safeName}`;
  const expiresInSeconds = 3600;
  const uploadUrl = await generateUploadUrl(
    storageKey,
    input.contentType ?? "application/octet-stream",
    expiresInSeconds
  );
  return {
    uploadUrl,
    storageKey,
    format,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
}

export interface RegisterUploadInput {
  userId: string;
  storageKey: string;
  originalFilename: string;
  format: SupportedFormat;
  fileSize: number;
  fileUnit?: SupportedUnit;
  /**
   * Optional listing metadata. When omitted, the file lands with the
   * same defaults as the print page's draft path: name derived from
   * the filename, license=free, price=0, visibility from the user's
   * defaultUploadVisibility setting.
   */
  metadata?: FileMetadataInput;
}

export interface RegisterUploadResult {
  fileAssetId: string;
  fileId: string;
  fileSlug: string;
  craftCloudModelId: string | null;
  warnings: string[];
}

export async function registerUploadForUser(
  input: RegisterUploadInput
): Promise<RegisterUploadResult | { error: string }> {
  if (!input.storageKey.startsWith(`uploads/${input.userId}/`)) {
    return { error: "Storage key does not match this user" };
  }

  const head = await objectExists(input.storageKey);
  if (!head.exists) {
    return {
      error:
        "No object found at storageKey. PUT the file to the presigned URL before calling register.",
    };
  }
  if (head.sizeBytes !== input.fileSize) {
    return {
      error: `Uploaded object size (${head.sizeBytes}) does not match declared fileSize (${input.fileSize})`,
    };
  }

  try {
    const meta = normalizeMetadata(input.metadata);
    const name = meta.name ?? deriveListingName(input.originalFilename);
    const slug = buildListingSlug(name);

    const [pref] = await db
      .select({ defaultUploadVisibility: users.defaultUploadVisibility })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const fallbackVisibility = pref?.defaultUploadVisibility ?? "private";
    const visibility = meta.visibility ?? fallbackVisibility;
    const status =
      meta.status ?? (visibility === "public" ? "published" : "draft");

    const [fileRow] = await db
      .insert(files)
      .values({
        userId: input.userId,
        name,
        slug,
        description: meta.description ?? null,
        price: meta.price ?? 0,
        license: meta.license ?? "cc_by",
        tags: meta.tags ?? null,
        designTags: meta.designTags ?? null,
        recommendedMaterialId: meta.recommendedMaterialId ?? null,
        minWallThickness: meta.minWallThickness ?? null,
        status,
        visibility,
      })
      .returning();

    const [asset] = await db
      .insert(fileAssets)
      .values({
        fileId: fileRow.id,
        storageKey: input.storageKey,
        originalFilename: input.originalFilename,
        format: input.format,
        fileUnit: input.fileUnit ?? "mm",
        fileSize: input.fileSize,
      })
      .returning({ id: fileAssets.id });

    after(() =>
      uploadAssetToCraftCloud({
        assetId: asset.id,
        storageKey: input.storageKey,
        originalFilename: input.originalFilename,
        unit: input.fileUnit ?? "mm",
      })
    );

    return {
      fileAssetId: asset.id,
      fileId: fileRow.id,
      fileSlug: fileRow.slug,
      craftCloudModelId: null,
      warnings: [],
    };
  } catch (error) {
    logError("registerUploadForUser", error);
    return { error: "Failed to register upload" };
  }
}

/**
 * Update an existing file listing's metadata. Pass only the fields
 * you want to change; unspecified fields stay untouched. Used by
 * the materialize_update_file MCP tool when the agent wants to set
 * a description, change the price, or flip private → public after
 * the initial upload.
 */
export async function updateFileForUser(params: {
  userId: string;
  fileId: string;
  metadata: FileMetadataInput;
}): Promise<
  | { fileId: string; slug: string }
  | { error: string }
> {
  const [row] = await db
    .select({ id: files.id, userId: files.userId, slug: files.slug })
    .from(files)
    .where(eq(files.id, params.fileId))
    .limit(1);
  if (!row || row.userId !== params.userId) {
    return { error: "File not found" };
  }
  const meta = normalizeMetadata(params.metadata);
  if (Object.keys(meta).length === 0) {
    return { fileId: row.id, slug: row.slug };
  }
  await db.update(files).set(meta).where(eq(files.id, row.id));
  return { fileId: row.id, slug: row.slug };
}

/**
 * Attach a curator-gallery photo to a file the agent owns. The bytes
 * must already be in R2 under the user's `photos/<userId>/` prefix
 * (use requestPhotoUploadUrlForUser first). Mirrors the web's
 * addFilePhoto action.
 */
export async function addFilePhotoForUser(params: {
  userId: string;
  fileId: string;
  storageKey: string;
  caption?: string;
}): Promise<{ photoId: string } | { error: string }> {
  const expected = `photos/${params.userId}/`;
  if (!params.storageKey.startsWith(expected)) {
    return { error: "Storage key does not match this user's photos prefix" };
  }
  const [file] = await db
    .select({ id: files.id, slug: files.slug })
    .from(files)
    .where(and(eq(files.id, params.fileId), eq(files.userId, params.userId)))
    .limit(1);
  if (!file) return { error: "File not found" };

  // Append at the end of the curator carousel.
  const existing = await db
    .select({ sortOrder: filePhotos.sortOrder })
    .from(filePhotos)
    .where(eq(filePhotos.fileId, file.id));
  const maxOrder = existing.reduce(
    (max, e) => Math.max(max, e.sortOrder),
    -1
  );

  const trimmedCaption = params.caption?.trim().slice(0, 500);

  const [photo] = await db
    .insert(filePhotos)
    .values({
      fileId: file.id,
      userId: params.userId,
      storageKey: params.storageKey,
      caption: trimmedCaption || null,
      sortOrder: maxOrder + 1,
      kind: "creator",
    })
    .returning();

  return { photoId: photo.id };
}

/**
 * Pick one of the file's curator photos as the cover image. Pass
 * `null` to revert to the auto-captured thumbnail.
 */
export async function setFileCoverPhotoForUser(params: {
  userId: string;
  fileId: string;
  photoId: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const [file] = await db
    .select({ id: files.id, userId: files.userId })
    .from(files)
    .where(eq(files.id, params.fileId))
    .limit(1);
  if (!file || file.userId !== params.userId) {
    return { error: "File not found" };
  }
  if (params.photoId !== null) {
    const [photo] = await db
      .select({
        id: filePhotos.id,
        fileId: filePhotos.fileId,
        kind: filePhotos.kind,
      })
      .from(filePhotos)
      .where(eq(filePhotos.id, params.photoId))
      .limit(1);
    if (
      !photo ||
      photo.fileId !== params.fileId ||
      photo.kind !== "creator"
    ) {
      return { error: "Photo doesn't belong to this file" };
    }
  }
  await db
    .update(files)
    .set({ coverPhotoId: params.photoId })
    .where(eq(files.id, params.fileId));
  return { ok: true };
}

/**
 * Presign for photo uploads (curator photos on files or projects,
 * build photos, etc.). The storage key returned is rooted at
 * `photos/<userId>/...` so the same prefix-check the web actions
 * use will accept it.
 */
export async function requestPhotoUploadUrlForUser(params: {
  userId: string;
  filename: string;
  sizeBytes: number;
  contentType?: string;
}): Promise<
  | { uploadUrl: string; storageKey: string; expiresAt: string }
  | { error: string }
> {
  const maxBytes = 20 * 1024 * 1024;
  if (params.sizeBytes <= 0 || params.sizeBytes > maxBytes) {
    return {
      error: `Photo size must be between 1 byte and ${maxBytes} bytes`,
    };
  }
  const ct = (params.contentType ?? "image/jpeg").toLowerCase();
  if (
    !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(ct)
  ) {
    return { error: "Unsupported photo content type" };
  }
  const safeName = sanitizeFilename(params.filename);
  const storageKey = `photos/${params.userId}/${nanoid()}/${safeName}`;
  const expiresIn = 3600;
  const uploadUrl = await generateUploadUrl(storageKey, ct, expiresIn);
  return {
    uploadUrl,
    storageKey,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * Presign for circuit / wiring uploads attached to a project. The
 * storage key is rooted at `circuits/<userId>/...` so the web's
 * project-side server actions accept it. Accepts both image
 * diagrams and KiCad source files; the underlying object is the
 * same shape (R2 PUT), only the add-circuit action differs.
 */
export async function requestCircuitUploadUrlForUser(params: {
  userId: string;
  filename: string;
  sizeBytes: number;
  contentType?: string;
}): Promise<
  | { uploadUrl: string; storageKey: string; expiresAt: string }
  | { error: string }
> {
  const maxBytes = 20 * 1024 * 1024;
  if (params.sizeBytes <= 0 || params.sizeBytes > maxBytes) {
    return {
      error: `Upload must be between 1 byte and ${maxBytes} bytes`,
    };
  }
  const ct = (params.contentType ?? "application/octet-stream").toLowerCase();
  // Same accept-list as the web's circuit-presign route (kicad files
  // arrive as octet-stream because browsers don't have a MIME for
  // them and the agent will set the same on their PUT).
  const isImage = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/svg+xml",
  ].includes(ct);
  const lowerName = params.filename.toLowerCase();
  const isKicad =
    lowerName.endsWith(".kicad_sch") ||
    lowerName.endsWith(".kicad_pcb") ||
    lowerName.endsWith(".kicad_pro");
  if (!isImage && !isKicad) {
    return {
      error:
        "Unsupported circuit upload — accepted: image/* or .kicad_sch / .kicad_pcb / .kicad_pro",
    };
  }
  const signedContentType = isImage ? ct : "application/octet-stream";
  const safeName = sanitizeFilename(params.filename);
  const storageKey = `circuits/${params.userId}/${nanoid()}/${safeName}`;
  const expiresIn = 3600;
  const uploadUrl = await generateUploadUrl(
    storageKey,
    signedContentType,
    expiresIn
  );
  return {
    uploadUrl,
    storageKey,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/** Cleanup helper used by project circuit/photo add tools on error. */
async function bestEffortDeleteR2(key: string) {
  try {
    await deleteObject(key);
  } catch (e) {
    logError("bestEffortDeleteR2", e);
  }
}
export { bestEffortDeleteR2 };

async function uploadAssetToCraftCloud(params: {
  assetId: string;
  storageKey: string;
  originalFilename: string;
  unit: SupportedUnit;
}) {
  try {
    const { generateDownloadUrl } = await import("@/lib/storage");
    const downloadUrl = await generateDownloadUrl(params.storageKey, 600);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`R2 download failed: ${res.status}`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    const model = await uploadModel(buffer, params.originalFilename, params.unit);

    await db
      .update(fileAssets)
      .set({
        craftCloudModelId: model.id,
        geometryData: model.geometry
          ? {
              dimensions: model.geometry.dimensions,
              volume: model.geometry.volume,
              triangleCount: model.geometry.triangleCount,
            }
          : undefined,
      })
      .where(eq(fileAssets.id, params.assetId));
  } catch (error) {
    logError("uploadAssetToCraftCloud", error);
  }
}

function deriveListingName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return base.length > 0 ? base.slice(0, 100) : "Untitled model";
}

function buildListingSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "model"}-${nanoid(6).toLowerCase()}`;
}

export interface AgentFileSummary {
  fileAssetId: string;
  /** The parent listing's id — pass into materialize_create_project, etc. */
  fileId: string;
  /** Public slug for /files/[slug] deep links. */
  slug: string;
  /** Display name on the listing — separate from `filename`. */
  name: string;
  filename: string;
  format: string;
  sizeBytes: number;
  unit: string;
  uploadedAt: string;
  craftCloudModelId: string | null;
  dimensions: { x: number; y: number; z: number } | null;
  status: string;
  visibility: string;
  priceCents: number;
  license: string;
}

export async function listFilesForUser(
  userId: string
): Promise<AgentFileSummary[]> {
  const rows = await db
    .select({
      assetId: fileAssets.id,
      fileId: files.id,
      slug: files.slug,
      name: files.name,
      status: files.status,
      visibility: files.visibility,
      price: files.price,
      license: files.license,
      originalFilename: fileAssets.originalFilename,
      format: fileAssets.format,
      fileSize: fileAssets.fileSize,
      fileUnit: fileAssets.fileUnit,
      createdAt: fileAssets.createdAt,
      craftCloudModelId: fileAssets.craftCloudModelId,
      geometryData: fileAssets.geometryData,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    // Library listing: unsaved text-to-CAD drafts stay studio-only
    // (docs/text-to-cad/05 §B). By-id MCP lookups intentionally don't
    // filter — drafts remain printable/orderable by their owner.
    .where(and(eq(files.userId, userId), notUnsavedStudioDraft()))
    .orderBy(desc(fileAssets.createdAt));

  return rows.map((r) => ({
    fileAssetId: r.assetId,
    fileId: r.fileId,
    slug: r.slug,
    name: r.name,
    filename: r.originalFilename,
    format: r.format,
    sizeBytes: r.fileSize,
    unit: r.fileUnit,
    uploadedAt: r.createdAt.toISOString(),
    craftCloudModelId: r.craftCloudModelId,
    dimensions: r.geometryData?.dimensions ?? null,
    status: r.status,
    visibility: r.visibility,
    priceCents: r.price,
    license: r.license,
  }));
}

export async function deleteFileForUser(params: {
  userId: string;
  fileAssetId: string;
}): Promise<{ ok: true } | { error: string }> {
  const [asset] = await db
    .select({
      assetId: fileAssets.id,
      ownerId: files.userId,
      fileId: files.id,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, params.fileAssetId))
    .limit(1);

  if (!asset || asset.ownerId !== params.userId) {
    return { error: "File not found" };
  }

  const referencedByOrder = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.userId, params.userId),
        eq(printOrders.fileAssetId, params.fileAssetId)
      )
    )
    .limit(1);

  const referencedByItem = await db
    .select({ id: printOrderItems.id })
    .from(printOrderItems)
    .where(eq(printOrderItems.fileAssetId, params.fileAssetId))
    .limit(1);

  if (referencedByOrder.length > 0 || referencedByItem.length > 0) {
    return {
      error:
        "Cannot delete: file is referenced by an existing print order. Use the dashboard to manage orders first.",
    };
  }

  await db.delete(files).where(eq(files.id, asset.fileId));
  return { ok: true };
}
