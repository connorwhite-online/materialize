import type { OrderStatusResponse } from "./types";

/**
 * Vendor statuses that imply the customer's production payment went
 * through — a vendor only starts (or finishes) work on a paid order.
 */
const PAID_VENDOR_STATUSES = new Set([
  "ordered",
  "in_production",
  "shipped",
  "received",
]);

/**
 * ⚠️ UNVERIFIED ASSUMPTION (CON-118 open question #2).
 *
 * Two-step checkout's reconciliation cron needs a "has the customer
 * paid CraftCloud via the hosted bridge session?" signal before it
 * captures our held service fee. CraftCloud exposes no explicit
 * payment-status field, so this probe ASSUMES the order status
 * endpoint only reports vendor statuses once payment has cleared —
 * an assumption nobody has confirmed against a live order yet.
 *
 * The function exists as a single swap point: when the first live
 * test order tells us what the real signal looks like, replace the
 * heuristic here and every caller inherits the fix.
 */
export function isProductionPaymentConfirmed(
  status: OrderStatusResponse
): boolean {
  return status.vendorStatuses.some((vendor) =>
    PAID_VENDOR_STATUSES.has(vendor.status)
  );
}
