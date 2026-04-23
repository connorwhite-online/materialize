import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  purchases,
  printOrders,
  printOrderItems,
} from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

export interface LibraryTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
}

/**
 * Loads the user's printable file library (owned + completed
 * purchases), resolves a primary asset per file, and sorts by
 * most-recently-printed. Files with no print history fall back
 * to the owned→purchased / createdAt-desc ordering so new users
 * still see a sensible grid.
 */
export async function loadLibraryTiles(userId: string): Promise<LibraryTile[]> {
  const ownedFiles = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
    })
    .from(files)
    .where(eq(files.userId, userId))
    .orderBy(desc(files.createdAt));

  const purchasedRows = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
    })
    .from(purchases)
    .innerJoin(files, eq(purchases.fileId, files.id))
    .where(
      and(eq(purchases.buyerId, userId), eq(purchases.status, "completed"))
    );

  const fileIds = [
    ...ownedFiles.map((f) => f.id),
    ...purchasedRows.map((r) => r.id),
  ];
  if (fileIds.length === 0) return [];

  const assetRows = await db
    .select({
      id: fileAssets.id,
      fileId: fileAssets.fileId,
      format: fileAssets.format,
      createdAt: fileAssets.createdAt,
    })
    .from(fileAssets)
    .where(inArray(fileAssets.fileId, fileIds))
    .orderBy(fileAssets.createdAt);

  const primaryByFileId = new Map<string, { id: string; format: string }>();
  for (const row of assetRows) {
    if (!row.fileId || primaryByFileId.has(row.fileId)) continue;
    primaryByFileId.set(row.fileId, { id: row.id, format: row.format });
  }

  const primaryAssetIds = Array.from(primaryByFileId.values()).map((a) => a.id);
  const lastPrintedByAssetId = new Map<string, Date>();
  if (primaryAssetIds.length > 0) {
    // Legacy single-item orders carry fileAssetId on printOrders
    // itself; multi-item orders leave it null and record per-item
    // rows in printOrderItems. Union both and take the max.
    const legacyPrints = await db
      .select({
        fileAssetId: printOrders.fileAssetId,
        lastPrintedAt: sql<Date>`max(${printOrders.createdAt})`,
      })
      .from(printOrders)
      .where(
        and(
          eq(printOrders.userId, userId),
          inArray(printOrders.fileAssetId, primaryAssetIds)
        )
      )
      .groupBy(printOrders.fileAssetId);
    for (const row of legacyPrints) {
      if (row.fileAssetId) {
        lastPrintedByAssetId.set(row.fileAssetId, row.lastPrintedAt);
      }
    }
    const itemPrints = await db
      .select({
        fileAssetId: printOrderItems.fileAssetId,
        lastPrintedAt: sql<Date>`max(${printOrders.createdAt})`,
      })
      .from(printOrderItems)
      .innerJoin(printOrders, eq(printOrderItems.printOrderId, printOrders.id))
      .where(
        and(
          eq(printOrders.userId, userId),
          inArray(printOrderItems.fileAssetId, primaryAssetIds)
        )
      )
      .groupBy(printOrderItems.fileAssetId);
    for (const row of itemPrints) {
      const prev = lastPrintedByAssetId.get(row.fileAssetId);
      if (!prev || row.lastPrintedAt > prev) {
        lastPrintedByAssetId.set(row.fileAssetId, row.lastPrintedAt);
      }
    }
  }

  const tiles: LibraryTile[] = [];
  for (const f of ownedFiles) {
    const asset = primaryByFileId.get(f.id);
    if (!asset) continue;
    tiles.push({
      fileAssetId: asset.id,
      name: f.name,
      thumbnailUrl: f.thumbnailUrl,
      format: asset.format,
      source: "owned",
    });
  }
  for (const r of purchasedRows) {
    const asset = primaryByFileId.get(r.id);
    if (!asset) continue;
    tiles.push({
      fileAssetId: asset.id,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      format: asset.format,
      source: "purchased",
    });
  }

  tiles.sort((a, b) => {
    const ta = lastPrintedByAssetId.get(a.fileAssetId)?.getTime() ?? -Infinity;
    const tb = lastPrintedByAssetId.get(b.fileAssetId)?.getTime() ?? -Infinity;
    return tb - ta;
  });
  return tiles;
}
