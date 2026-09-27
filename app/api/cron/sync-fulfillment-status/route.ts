import { syncFulfillmentStatuses } from "@/lib/craftcloud/fulfillment-sync";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Hourly fulfillment sweep (CON-107): polls CraftCloud for every order
 * at `ordered` or later and advances it through in_production →
 * shipped → received (or blocked / cancelled). CraftCloud has no
 * webhooks, so this is the only path past `ordered`. See
 * `lib/craftcloud/fulfillment-sync.ts`.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Wired in vercel.json (hourly). To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/sync-fulfillment-status
 */

// 500 rows over a 4-worker pool at one CraftCloud GET each; same
// ceiling as reconcile-production-payments (MTR-144). Writes are
// conditioned on the status read, so a mid-sweep kill is safe.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logError(
      "cron/sync-fulfillment-status.auth",
      new Error("CRON_SECRET not configured")
    );
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    logError(
      "cron/sync-fulfillment-status.auth",
      new Error("Unauthorized cron request")
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncFulfillmentStatuses();
    console.log("[cron/sync-fulfillment-status] swept", result);
    if (result.errors > 0) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    logError("cron/sync-fulfillment-status", error);
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
}
