import "server-only";
import { eq } from "drizzle-orm";
import { printOrders } from "@/lib/db/schema";
import { isCraftCloudTestOrder } from "@/lib/env";

/**
 * WHERE clause for buyer-facing order lists. On a live deployment,
 * orders placed in sandbox mode are hidden so they don't bury real
 * ones; in sandbox everything shows, since test orders are the point
 * there. Returns undefined (no filter) in sandbox — drizzle's `and()`
 * drops undefined terms.
 */
export function visibleOrdersFilter() {
  return isCraftCloudTestOrder() ? undefined : eq(printOrders.isTest, false);
}
