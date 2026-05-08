import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  printOrderItems,
  printOrders,
  users,
} from "@/lib/db/schema";
import { findMaterialConfig } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";
import { notifyPrintOnFile } from "./notify";
import type { PrintOnFilePayload } from "./types";

interface RowForNotify {
  fileId: string;
  fileSlug: string;
  fileName: string;
  ownerId: string;
  materialConfigId: string | null;
}

/**
 * Notify every file owner whose work just entered the printing
 * pipeline via `printOrderId`. Called from
 * `handlePrintOrderPayment` right after the status transition to
 * `ordered`.
 *
 * Handles both the legacy single-item path (printOrders.fileAssetId
 * set on the parent row) and the multi-item path (rows in
 * printOrderItems). One notification per distinct file — so a buyer
 * who orders three different colorways of the same file generates a
 * single creator notification, not three.
 *
 * Errors are swallowed at the helper level because notifications are
 * a side effect; the order placement must succeed even if no
 * notification gets through.
 */
export async function notifyPrintOrderPlaced(
  printOrderId: string
): Promise<void> {
  try {
    // Resolve buyer + the order shape (legacy vs multi-item).
    const [order] = await db
      .select({
        id: printOrders.id,
        userId: printOrders.userId,
        fileAssetId: printOrders.fileAssetId,
        material: printOrders.material,
      })
      .from(printOrders)
      .where(eq(printOrders.id, printOrderId));
    if (!order) return;

    const [buyer] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, order.userId));
    if (!buyer) return;

    let rows: RowForNotify[] = [];
    if (order.fileAssetId) {
      // Legacy single-item path. The order's own `material` column
      // is the configId.
      const [r] = await db
        .select({
          fileId: files.id,
          fileSlug: files.slug,
          fileName: files.name,
          ownerId: files.userId,
        })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(fileAssets.id, order.fileAssetId));
      if (r) {
        rows = [
          {
            ...r,
            materialConfigId: order.material ?? null,
          },
        ];
      }
    } else {
      const items = await db
        .select({
          fileAssetId: printOrderItems.fileAssetId,
          materialConfigId: printOrderItems.materialConfigId,
        })
        .from(printOrderItems)
        .where(eq(printOrderItems.printOrderId, printOrderId));
      if (items.length === 0) return;

      const fileLookups = await db
        .select({
          assetId: fileAssets.id,
          fileId: files.id,
          fileSlug: files.slug,
          fileName: files.name,
          ownerId: files.userId,
        })
        .from(fileAssets)
        .innerJoin(files, eq(fileAssets.fileId, files.id))
        .where(
          inArray(
            fileAssets.id,
            items.map((it) => it.fileAssetId)
          )
        );
      const byAssetId = new Map(fileLookups.map((r) => [r.assetId, r]));

      // Dedupe by fileId so a buyer ordering the same file in two
      // colorways generates one notification, not two. Material label
      // for the deduped row uses the first item's material — good
      // enough for a notification snippet.
      const seen = new Set<string>();
      for (const item of items) {
        const f = byAssetId.get(item.fileAssetId);
        if (!f || seen.has(f.fileId)) continue;
        seen.add(f.fileId);
        rows.push({
          fileId: f.fileId,
          fileSlug: f.fileSlug,
          fileName: f.fileName,
          ownerId: f.ownerId,
          materialConfigId: item.materialConfigId,
        });
      }
    }

    // Resolve material display names in parallel — the catalog is
    // 24h-cached, so this is essentially free after warm-up.
    const labelResults = await Promise.all(
      rows.map(async (row) => {
        if (!row.materialConfigId) return null;
        const entry = await findMaterialConfig(row.materialConfigId);
        if (!entry) return null;
        const color = entry.config.color || entry.config.originalColorName;
        return [entry.material.name, color].filter(Boolean).join(" ") || null;
      })
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const payload: PrintOnFilePayload = {
        actor: buyer,
        listing: {
          kind: "file",
          name: row.fileName,
          slug: row.fileSlug,
        },
        printOrderId,
        materialLabel: labelResults[i],
      };
      // Self-events (creator buying their own file) are filtered
      // inside notifyPrintOnFile via the recipient===actor check.
      await notifyPrintOnFile(row.ownerId, payload);
    }
  } catch (error) {
    logError("notifyPrintOrderPlaced", error);
  }
}
