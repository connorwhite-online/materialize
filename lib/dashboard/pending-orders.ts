import "server-only";

import { db } from "@/lib/db";
import { fileAssets, files, printOrders, printOrderItems } from "@/lib/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { withDbRetry } from "@/lib/db/retry";
import { visibleOrdersFilter } from "@/lib/print/order-visibility";

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
  // Placed and on their way. Left out before, so an order vanished
  // from home the moment it became real.
  "ordered",
  "in_production",
  "shipped",
  "blocked",
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
  fileAssetId: string | null;
  fileCount: number;
  /**
   * The (first) ordered part: listing name, else the upload's filename.
   * Null when the asset is gone.
   */
  title: string | null;
  /** Listing thumbnail for that part, when one was ever captured. */
  thumbnailUrl: string | null;
  /** Units of the (first) part. */
  quantity: number;
  /** ISO timestamp — when the order row was created / started. */
  createdAt: string;
  /**
   * The emailed confirmation capability, for awaiting_agent_approval
   * orders only. /orders/[id]/confirm 404s without it, so the home tile
   * has to carry it; the viewer is the order's owner, who was already
   * emailed this same link.
   */
  confirmationToken?: string | null;
};

/** Always a count: "1 file" / "3 files". */
export function formatOrderFileCount(fileCount: number): string {
  const n = Math.max(1, fileCount);
  return n === 1 ? "1 file" : `${n} files`;
}

/** "bracket.stl" → "bracket"; listing names pass through unchanged. */
export function displayPartName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\.(stl|obj|3mf|step|stp|amf)$/i, "");
}

/** Short calendar date for the card meta line. */
export function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function orderNeedsAttention(status: PendingOrderStatus): boolean {
  return (ATTENTION_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Attention-needed first, then newest. Pure so the home carousel order
 * is unit-testable without a DB.
 */
export function sortHomeOrders<
  T extends { status: PendingOrderStatus; id: string; createdAt: string },
>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const aAttn = orderNeedsAttention(a.status) ? 0 : 1;
    const bAttn = orderNeedsAttention(b.status) ? 0 : 1;
    if (aAttn !== bAttn) return aAttn - bAttn;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

const PENDING_MAX = 12;

/**
 * In-progress print orders for the authed home carousel. File count is
 * 1 for legacy single-item rows; multi-item carts count distinct
 * printOrderItems.fileAssetId values.
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
      createdAt: printOrders.createdAt,
      confirmationToken: printOrders.confirmationToken,
      quantity: printOrders.quantity,
    })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.userId, userId),
        visibleOrdersFilter(),
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
            quantity: printOrderItems.quantity,
          })
          .from(printOrderItems)
          .where(inArray(printOrderItems.printOrderId, multiItemIds))
          .orderBy(printOrderItems.createdAt)
      : [];

  const fileIdsByOrder = new Map<string, Set<string>>();
  const firstItemByOrder = new Map<string, { fileAssetId: string; quantity: number }>();
  for (const item of multiItemMeta) {
    let set = fileIdsByOrder.get(item.printOrderId);
    if (!set) {
      set = new Set();
      fileIdsByOrder.set(item.printOrderId, set);
    }
    set.add(item.fileAssetId);
    if (!firstItemByOrder.has(item.printOrderId)) {
      firstItemByOrder.set(item.printOrderId, item);
    }
  }

  // One lookup for every card's lead part: name + thumbnail. A plain
  // DB join — deliberately no CraftCloud catalog call on the home page.
  const leadAssetIds = [
    ...new Set(
      draftsRaw
        .map((d) => d.fileAssetId ?? firstItemByOrder.get(d.id)?.fileAssetId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const partRows =
    leadAssetIds.length > 0
      ? await db
          .select({
            assetId: fileAssets.id,
            originalFilename: fileAssets.originalFilename,
            name: files.name,
            thumbnailUrl: files.thumbnailUrl,
          })
          .from(fileAssets)
          .leftJoin(files, eq(files.id, fileAssets.fileId))
          .where(inArray(fileAssets.id, leadAssetIds))
      : [];
  const partByAsset = new Map(partRows.map((r) => [r.assetId, r]));

  const mapped: PendingOrder[] = draftsRaw.map((d) => {
    const multiFiles = !d.fileAssetId
      ? fileIdsByOrder.get(d.id)
      : undefined;
    const first = firstItemByOrder.get(d.id);
    const part = partByAsset.get(d.fileAssetId ?? first?.fileAssetId ?? "");
    return {
      id: d.id,
      status: d.status as PendingOrderStatus,
      material: d.material,
      fileAssetId: d.fileAssetId,
      fileCount: multiFiles ? Math.max(multiFiles.size, 1) : 1,
      title: displayPartName(part?.name ?? part?.originalFilename),
      thumbnailUrl: part?.thumbnailUrl ?? null,
      quantity: Math.max(1, d.quantity ?? first?.quantity ?? 1),
      createdAt: d.createdAt.toISOString(),
      confirmationToken:
        d.status === "awaiting_agent_approval" ? d.confirmationToken : null,
    };
  });

  return sortHomeOrders(mapped);
}

export function pendingOrderHref(order: PendingOrder): string {
  if (order.status === "awaiting_agent_approval" && order.confirmationToken) {
    return `/orders/${order.id}/confirm?token=${encodeURIComponent(order.confirmationToken)}`;
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
