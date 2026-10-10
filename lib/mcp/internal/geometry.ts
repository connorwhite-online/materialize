import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { parseMeshTriangles, type MeshFormat } from "@/lib/hashing/mesh-fingerprint";
import { analyzeTriangles } from "@/lib/dfm/mesh-analysis";

export interface StoredGeometry {
  dimensions: { x: number; y: number; z: number };
  /** mm³, like CraftCloud's own model geometry. */
  volume: number;
  triangleCount: number;
}

/**
 * Size, volume and triangle count measured from the mesh itself, in the
 * `fileAssets.geometryData` shape. CraftCloud's model upload stopped
 * returning geometry when /v5/model went away, so without this every
 * agent upload had null dimensions: quotes showed no size and
 * list_files had nothing to report. Null for formats we don't parse
 * (STEP, AMF) or a mesh that won't parse.
 */
export function measureGeometry(
  bytes: Uint8Array,
  format: string,
  unit: "mm" | "cm" | "in"
): StoredGeometry | null {
  const triangles = parseMeshTriangles(bytes, format as MeshFormat);
  if (!triangles) return null;
  const a = analyzeTriangles(triangles, unit);
  if (!(a.bboxMm.x > 0 && a.bboxMm.y > 0 && a.bboxMm.z > 0)) return null;
  return { dimensions: a.bboxMm, volume: a.volumeMm3, triangleCount: a.triangleCount };
}

/**
 * CraftCloud's confirm step can return a model with all-zero dimensions
 * (seen on fresh imports), which reads as present but is useless, so a
 * zero anywhere counts as missing.
 */
export function hasDimensions(
  g: { dimensions?: { x: number; y: number; z: number } } | null | undefined
): boolean {
  const d = g?.dimensions;
  return !!d && d.x > 0 && d.y > 0 && d.z > 0;
}

/**
 * The asset's stored geometry, measuring and saving it first when it was
 * never recorded (every agent upload before this fix). Best-effort: a
 * read or parse failure returns whatever was stored.
 */
export async function ensureGeometry(asset: {
  id: string;
  storageKey: string;
  format: string;
  fileUnit: string;
  geometryData: { dimensions?: { x: number; y: number; z: number }; volume?: number; triangleCount?: number } | null;
}) {
  if (hasDimensions(asset.geometryData)) return asset.geometryData;
  try {
    const bytes = await getObjectBytes(asset.storageKey);
    const measured = measureGeometry(bytes, asset.format, asset.fileUnit as "mm" | "cm" | "in");
    if (!measured) return asset.geometryData;
    await db
      .update(fileAssets)
      .set({ geometryData: measured })
      .where(eq(fileAssets.id, asset.id));
    return measured;
  } catch (err) {
    logError("mcp.geometry.backfill", err);
    return asset.geometryData;
  }
}
