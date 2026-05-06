import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  printOrders,
  printOrderItems,
  users,
} from "@/lib/db/schema";
import { generateUploadUrl, objectExists } from "@/lib/storage";
import { uploadModel } from "@/lib/craftcloud/client";
import { logError } from "@/lib/logger";

const SUPPORTED_FORMATS = ["stl", "obj", "3mf", "step", "amf"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

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
}

export interface RegisterUploadResult {
  fileAssetId: string;
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
    const name = deriveListingName(input.originalFilename);
    const slug = buildListingSlug(name);

    const [pref] = await db
      .select({ defaultUploadVisibility: users.defaultUploadVisibility })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const visibility = pref?.defaultUploadVisibility ?? "private";

    const [fileRow] = await db
      .insert(files)
      .values({
        userId: input.userId,
        name,
        slug,
        price: 0,
        license: "free",
        status: visibility === "public" ? "published" : "draft",
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

    return { fileAssetId: asset.id, craftCloudModelId: null, warnings: [] };
  } catch (error) {
    logError("registerUploadForUser", error);
    return { error: "Failed to register upload" };
  }
}

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
  filename: string;
  format: string;
  sizeBytes: number;
  unit: string;
  uploadedAt: string;
  craftCloudModelId: string | null;
  dimensions: { x: number; y: number; z: number } | null;
}

export async function listFilesForUser(
  userId: string
): Promise<AgentFileSummary[]> {
  const rows = await db
    .select({
      assetId: fileAssets.id,
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
    .where(eq(files.userId, userId))
    .orderBy(desc(fileAssets.createdAt));

  return rows.map((r) => ({
    fileAssetId: r.assetId,
    filename: r.originalFilename,
    format: r.format,
    sizeBytes: r.fileSize,
    unit: r.fileUnit,
    uploadedAt: r.createdAt.toISOString(),
    craftCloudModelId: r.craftCloudModelId,
    dimensions: r.geometryData?.dimensions ?? null,
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
