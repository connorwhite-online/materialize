import "server-only";

import { db } from "@/lib/db";
import {
  printOrders,
  printOrderItems,
  fileAssets,
  files,
} from "@/lib/db/schema";
import { eq, desc, and, inArray, asc } from "drizzle-orm";
import { withDbRetry } from "@/lib/db/retry";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";

/**
 * In-progress print orders shown on the authed-home Orders carousel.
 * Actionable statuses (user must do something) are sorted ahead of
 * `auto_approved` (system is placing — no user action).
 */
export const PENDING_ORDER_STATUSES = [
  "cart_created",
  "awaiting_production_payment",
  "awaiting_agent_approval",
  "auto_approved",
] as const;

export type PendingOrderStatus = (typeof PENDING_ORDER_STATUSES)[number];

/** Statuses where the user still has a step to take. */
export const ATTENTION_ORDER_STATUSES = [
  "cart_created",
  "awaiting_production_payment",
  "awaiting_agent_approval",
] as const satisfies readonly PendingOrderStatus[];

export type PendingOrder = {
  id: string;
  status: PendingOrderStatus;
  /** CraftCloud material config UUID — used for resume deep-links. */
  material: string | null;
  /**
   * Display label for a single-material order (`material · color`).
   * Null when unknown or when `materialCount > 1` (tile shows a count).
   */
  materialName: string | null;
  fileAssetId: string | null;
  /** First / only file name — null when `fileCount > 1` (tile shows a count). */
  fileName: string | null;
  fileCount: number;
  materialCount: number;
};

/**
 * Compact material line for order cards. Color alone is not enough
 * ("Black"), and finish is usually redundant on a 13rem tile.
 */
export function formatPendingMaterialName(
  materialName: string | null | undefined,
  color: string | null | undefined
): string | null {
  const parts = [materialName, color].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** File line: the name for one file, otherwise "N files". */
export function formatOrderFileLine(
  fileCount: number,
  fileName: string | null
): string {
  if (fileCount > 1) return `${fileCount} files`;
  return fileName?.trim() || "3D Print";
}

/** Material line: the label for one material, otherwise "N materials". */
export function formatOrderMaterialLine(
  materialCount: number,
  materialName: string | null
): string | null {
  if (materialCount > 1) return `${materialCount} materials`;
  return materialName;
}

export function orderNeedsAttention(status: PendingOrderStatus): boolean {
  return (ATTENTION_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Attention-needed first, then newest. Pure so the home carousel order
 * is unit-testable without a DB.
 */
export function sortHomeOrders<
  T extends { status: PendingOrderStatus; id: string },
>(orders: T[], createdAtById: Map<string, number>): T[] {
  return [...orders].sort((a, b) => {
    const aAttn = orderNeedsAttention(a.status) ? 0 : 1;
    const bAttn = orderNeedsAttention(b.status) ? 0 : 1;
    if (aAttn !== bAttn) return aAttn - bAttn;
    return (createdAtById.get(b.id) ?? 0) - (createdAtById.get(a.id) ?? 0);
  });
}

const PENDING_MAX = 12;

/**
 * In-progress print orders for the authed home carousel. Filename is
 * best-effort: legacy single-item rows join through fileAssets; multi-
 * item carts aggregate counts from printOrderItems.
 */
export async function loadPendingOrders(
  userId: string
): Promise<PendingOrder[]> {
  return withDbRetry(() => loadPendingOrdersOnce(userId), { retries: 1 });
}

async function loadPendingOrdersOnce(userId: string): Promise<PendingOrder[]> {
  const draftsRaw = await db
    .select({
      id: printOrders.id,
      status: printOrders.status,
      material: printOrders.material,
      fileAssetId: printOrders.fileAssetId,
      fileName: files.name,
      createdAt: printOrders.createdAt,
    })
    .from(printOrders)
    .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(
      and(
        eq(printOrders.userId, userId),
        inArray(printOrders.status, [...PENDING_ORDER_STATUSES])
      )
    )
    .orderBy(desc(printOrders.createdAt))
    .limit(PENDING_MAX);

  const multiItemIds = draftsRaw.filter((d) => !d.fileAssetId).map((d) => d.id);
  const multiItemMeta =
    multiItemIds.length > 0
      ? await db
          .select({
            printOrderId: printOrderItems.printOrderId,
            fileAssetId: printOrderItems.fileAssetId,
            materialConfigId: printOrderItems.materialConfigId,
            fileName: files.name,
            originalFilename: fileAssets.originalFilename,
          })
          .from(printOrderItems)
          .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(inArray(printOrderItems.printOrderId, multiItemIds))
          .orderBy(asc(printOrderItems.createdAt))
      : [];

  type MultiAgg = {
    firstName: string | null;
    fileIds: Set<string>;
    materialIds: Set<string>;
  };
  const multiByOrder = new Map<string, MultiAgg>();
  for (const item of multiItemMeta) {
    let agg = multiByOrder.get(item.printOrderId);
    if (!agg) {
      agg = {
        firstName:
          item.fileName ??
          item.originalFilename?.replace(/\.[^.]+$/, "") ??
          null,
        fileIds: new Set(),
        materialIds: new Set(),
      };
      multiByOrder.set(item.printOrderId, agg);
    }
    agg.fileIds.add(item.fileAssetId);
    if (item.materialConfigId) agg.materialIds.add(item.materialConfigId);
  }

  // One catalog fetch for the whole carousel — printOrders.material is
  // a CraftCloud config UUID, not a lib/materials slug. Misses stay
  // null so the tile never prints a raw UUID.
  const catalog = await getCraftCloudCatalog().catch(() => null);

  const mapped = draftsRaw.map((d) => {
    const multi = !d.fileAssetId ? multiByOrder.get(d.id) : undefined;
    const fileCount = multi ? Math.max(multi.fileIds.size, 1) : 1;
    const materialCount = multi
      ? multi.materialIds.size
      : d.material
        ? 1
        : 0;

    const singleMaterialId =
      materialCount === 1
        ? multi
          ? [...multi.materialIds][0]
          : d.material
        : null;
    const entry =
      singleMaterialId && catalog
        ? catalog.configById.get(singleMaterialId)
        : undefined;

    return {
      id: d.id,
      status: d.status as PendingOrderStatus,
      material: d.material,
      materialName:
        materialCount === 1
          ? formatPendingMaterialName(
              entry?.material.name,
              entry?.config.color
            )
          : null,
      fileAssetId: d.fileAssetId,
      fileName:
        fileCount === 1
          ? (d.fileName ?? multi?.firstName ?? null)
          : null,
      fileCount,
      materialCount,
      createdAtMs: d.createdAt.getTime(),
    };
  });

  const createdAtById = new Map(
    mapped.map((o) => [o.id, o.createdAtMs] as const)
  );
  return sortHomeOrders(mapped, createdAtById).map(
    ({ createdAtMs: _createdAtMs, ...order }) => order
  );
}

export function pendingOrderHref(order: PendingOrder): string {
  if (order.status === "awaiting_agent_approval") {
    return `/orders/${order.id}/confirm`;
  }
  if (order.status === "awaiting_production_payment") {
    return `/orders/${order.id}/pay-production`;
  }
  if (order.status === "cart_created" && order.fileAssetId) {
    const qs = order.material ? `?material=${order.material}` : "";
    return `/print/${order.fileAssetId}${qs}`;
  }
  return `/dashboard/orders/${order.id}`;
}
