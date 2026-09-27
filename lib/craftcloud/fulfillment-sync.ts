import "server-only";
import { and, eq, inArray, not, like, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { getOrderStatus } from "@/lib/craftcloud/client";
import { logError } from "@/lib/logger";
import type { OrderStatus, OrderStatusResponse } from "./types";

/**
 * Our order statuses this sweep polls. Everything before `ordered`
 * belongs to checkout (and its own crons); `received`, `cancelled` and
 * `refunded` are terminal. `blocked` stays in because a vendor can
 * unblock and resume.
 */
export const SYNCABLE_STATUSES = [
  "ordered",
  "in_production",
  "shipped",
  "blocked",
] as const;
export type SyncableStatus = (typeof SYNCABLE_STATUSES)[number];

const PROGRESS_RANK: Partial<Record<OrderStatus, number>> = {
  ordered: 0,
  in_production: 1,
  shipped: 2,
  received: 3,
};

/**
 * Decide the status to write for one order, or null to leave it.
 *
 * Forward-only along ordered → in_production → shipped → received, so
 * a stale or out-of-order CraftCloud read can never walk an order
 * backwards. `blocked` and `cancelled` are side exits that apply from
 * any polled state, and a `blocked` order moves to whatever progress
 * status CraftCloud reports once it resumes.
 */
export function nextFulfillmentStatus(
  current: SyncableStatus,
  reported: OrderStatus | undefined
): OrderStatus | null {
  if (!reported || reported === current) return null;
  if (reported === "blocked" || reported === "cancelled") return reported;
  if (current === "blocked") return reported;
  const from = PROGRESS_RANK[current];
  const to = PROGRESS_RANK[reported];
  if (from === undefined || to === undefined) return null;
  return to > from ? reported : null;
}

/** The vendor part of a CraftCloud order that matches our row. */
export function pickVendorStatus(
  status: OrderStatusResponse,
  vendorId: string | null
): OrderStatus | undefined {
  const match =
    (vendorId && status.vendorStatuses.find((v) => v.vendorId === vendorId)) ||
    status.vendorStatuses[0];
  return match?.status;
}

export interface FulfillmentSyncResult {
  scanned: number;
  updated: number;
  errors: number;
}

/**
 * Fulfillment sweep (CON-107). CraftCloud has no webhooks — its API
 * spec offers none — so the only way an order moves past `ordered` is
 * polling `GET /v5/order/{id}/status`. Each row is handled on its own
 * so one CraftCloud error doesn't stop the sweep, and every write is
 * conditioned on the status we read, so a concurrent refund or a
 * second sweep can't be clobbered.
 *
 * Tracking numbers are not available: the status endpoint doesn't
 * return them, so `trackingInfo` is left alone.
 */
export async function syncFulfillmentStatuses(): Promise<FulfillmentSyncResult> {
  const rows = await db
    .select({
      id: printOrders.id,
      status: printOrders.status,
      vendor: printOrders.vendor,
      craftCloudOrderId: printOrders.craftCloudOrderId,
    })
    .from(printOrders)
    .where(
      and(
        inArray(printOrders.status, [...SYNCABLE_STATUSES]),
        isNotNull(printOrders.craftCloudOrderId),
        // `placing:` is the webhook's claim sentinel, not a real id.
        not(like(printOrders.craftCloudOrderId, "placing:%"))
      )
    )
    .limit(500);

  const result: FulfillmentSyncResult = {
    scanned: rows.length,
    updated: 0,
    errors: 0,
  };

  async function processRow(row: (typeof rows)[number]) {
    try {
      const current = row.status as SyncableStatus;
      const status = await getOrderStatus(row.craftCloudOrderId!);
      const next = nextFulfillmentStatus(
        current,
        pickVendorStatus(status, row.vendor)
      );
      if (!next) return;

      const updated = await db
        .update(printOrders)
        .set({ status: next })
        .where(
          and(eq(printOrders.id, row.id), eq(printOrders.status, current))
        )
        .returning({ id: printOrders.id });
      if (updated.length === 0) return;
      result.updated++;

      if (next === "cancelled") {
        // The customer has already paid for this order (us under
        // single checkout, CraftCloud under two_step), and nothing
        // here refunds it. Surface it so someone does.
        logError(
          "syncFulfillmentStatuses.vendorCancelled",
          new Error(
            `CraftCloud cancelled order ${row.id} (${row.craftCloudOrderId}); check whether a refund is owed`
          )
        );
      }
    } catch (error) {
      logError("syncFulfillmentStatuses.order", error);
      result.errors++;
    }
  }

  // Same bounded pool as reconcileProductionPayments.
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      await processRow(rows[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker())
  );

  return result;
}
