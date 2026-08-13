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

/** Orders that still need the user to do something. */
export const PENDING_ORDER_STATUSES = [
  "cart_created",
  "awaiting_production_payment",
  "awaiting_agent_approval",
  "auto_approved",
] as const;

export type PendingOrderStatus = (typeof PENDING_ORDER_STATUSES)[number];

export type PendingOrder = {
  id: string;
  status: PendingOrderStatus;
  material: string | null;
  vendorName: string | null;
  totalPrice: number;
  serviceFee: number;
  fileAssetId: string | null;
  fileName: string | null;
};

const PENDING_MAX = 12;

/**
 * In-progress print orders for the authed home carousel. Filename is
 * best-effort: legacy single-item rows join through fileAssets; multi-
 * item carts fall back to the first line item.
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
      vendor: printOrders.vendor,
      vendorName: printOrders.vendorName,
      totalPrice: printOrders.totalPrice,
      serviceFee: printOrders.serviceFee,
      fileAssetId: printOrders.fileAssetId,
      fileName: files.name,
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
            fileName: files.name,
            originalFilename: fileAssets.originalFilename,
          })
          .from(printOrderItems)
          .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(inArray(printOrderItems.printOrderId, multiItemIds))
          .orderBy(asc(printOrderItems.createdAt))
      : [];

  const firstNameByOrder = new Map<string, { name: string; count: number }>();
  for (const item of multiItemMeta) {
    const existing = firstNameByOrder.get(item.printOrderId);
    if (existing) {
      existing.count += 1;
    } else {
      firstNameByOrder.set(item.printOrderId, {
        name:
          item.fileName ??
          item.originalFilename?.replace(/\.[^.]+$/, "") ??
          "3D Print",
        count: 1,
      });
    }
  }

  return draftsRaw.map((d) => {
    const meta = !d.fileAssetId ? firstNameByOrder.get(d.id) : undefined;
    const fileName = d.fileName
      ? d.fileName
      : meta
        ? meta.count > 1
          ? `${meta.name} + ${meta.count - 1} more`
          : meta.name
        : null;
    return {
      id: d.id,
      status: d.status as PendingOrderStatus,
      material: d.material,
      vendorName: d.vendorName ?? d.vendor ?? null,
      totalPrice: d.totalPrice,
      serviceFee: d.serviceFee,
      fileAssetId: d.fileAssetId,
      fileName,
    };
  });
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
