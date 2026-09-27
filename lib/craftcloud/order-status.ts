import type { OrderStatus, OrderStatusResponse } from "./types";

/**
 * The wire shape of `GET /v5/order/{orderId}/status`, per CraftCloud's
 * published spec (https://api.craftcloud3d.com/api-docs.json). Each
 * vendor's part of the order carries its full status history, not a
 * single current status, and there is no tracking info on this
 * endpoint at all.
 */
export interface RawOrderStatusResponse {
  orderNumber: string;
  status: Array<{
    vendorId: string;
    cancelled: boolean;
    orderStatus: Array<{ type: OrderStatus; date: string }>;
  }>;
  estDeliveryTime?: Record<string, string>;
}

/**
 * Collapse CraftCloud's per-vendor status history into the flat
 * `vendorStatuses` shape every caller reads. Before this existed the
 * client returned the raw payload typed as `OrderStatusResponse`, so
 * `vendorStatuses` was undefined on every live response and each
 * caller threw — including the two-step reconcile cron, which could
 * then never confirm a production payment.
 *
 * - A cancelled part reports "cancelled" whatever its history says.
 * - Otherwise the newest history entry wins (by date, falling back to
 *   array order when dates don't parse).
 * - A part with no history yet is left out, which keeps the "no vendor
 *   statuses = production not paid yet" reading that
 *   isProductionPaymentConfirmed relies on.
 */
export function normalizeOrderStatus(
  orderId: string,
  raw: RawOrderStatusResponse
): OrderStatusResponse {
  const vendorStatuses: OrderStatusResponse["vendorStatuses"] = [];
  for (const part of raw.status ?? []) {
    if (part.cancelled) {
      vendorStatuses.push({ vendorId: part.vendorId, status: "cancelled" });
      continue;
    }
    const latest = latestEntry(part.orderStatus ?? []);
    if (latest) {
      vendorStatuses.push({ vendorId: part.vendorId, status: latest.type });
    }
  }
  return { orderId, orderNumber: raw.orderNumber, vendorStatuses };
}

function latestEntry<T extends { date: string }>(entries: T[]): T | undefined {
  let best: T | undefined;
  let bestTime = -Infinity;
  for (const entry of entries) {
    const time = Date.parse(entry.date);
    const t = Number.isNaN(time) ? bestTime : time;
    // >= so a later array entry wins ties and unparseable dates.
    if (!best || t >= bestTime) {
      best = entry;
      bestTime = t;
    }
  }
  return best;
}
