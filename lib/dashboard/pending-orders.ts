import "server-only";

import { db } from "@/lib/db";
import { printOrders, printOrderItems } from "@/lib/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { withDbRetry } from "@/lib/db/retry";

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
  fileAssetId: string | null;
  fileCount: number;
  /** ISO timestamp — when the order row was created / started. */
  createdAt: string;
};

/** Always a count: "1 file" / "3 files". */
export function formatOrderFileCount(fileCount: number): string {
  const n = Math.max(1, fileCount);
  return n === 1 ? "1 file" : `${n} files`;
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
    })
    .from(printOrders)
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
          })
          .from(printOrderItems)
          .where(inArray(printOrderItems.printOrderId, multiItemIds))
      : [];

  const fileIdsByOrder = new Map<string, Set<string>>();
  for (const item of multiItemMeta) {
    let set = fileIdsByOrder.get(item.printOrderId);
    if (!set) {
      set = new Set();
      fileIdsByOrder.set(item.printOrderId, set);
    }
    set.add(item.fileAssetId);
  }

  const mapped: PendingOrder[] = draftsRaw.map((d) => {
    const multiFiles = !d.fileAssetId
      ? fileIdsByOrder.get(d.id)
      : undefined;
    return {
      id: d.id,
      status: d.status as PendingOrderStatus,
      material: d.material,
      fileAssetId: d.fileAssetId,
      fileCount: multiFiles ? Math.max(multiFiles.size, 1) : 1,
      createdAt: d.createdAt.toISOString(),
    };
  });

  return sortHomeOrders(mapped);
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
