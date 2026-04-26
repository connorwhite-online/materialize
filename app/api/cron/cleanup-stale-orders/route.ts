import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { logError } from "@/lib/logger";

/**
 * Daily sweep: cancel `printOrders` rows that have been stuck in
 * `cart_created` for too long. They land here when the user closed
 * the tab between createPrintOrder and completePrintOrder, when the
 * Stripe checkout never got opened, or when the chain partially
 * failed leaving an orphan row that the user can't see or recover.
 *
 * 48h is generous: real checkouts complete in seconds, and a Stripe
 * Checkout session itself expires after 24h. By 48h we're confident
 * nothing legitimate is still in flight.
 *
 * Auth: when Vercel cron triggers this route it includes
 * `Authorization: Bearer ${CRON_SECRET}`. Without that header (or
 * with a wrong value) we 401 — keeps random external hits from
 * mass-cancelling user orders.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/cleanup-stale-orders
 */

const STALE_AGE_MS = 48 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Refuse to run if no secret is configured — a misconfigured
    // production env var should not silently disable auth.
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - STALE_AGE_MS);

    const cancelled = await db
      .update(printOrders)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(printOrders.status, "cart_created"),
          lt(printOrders.createdAt, cutoff)
        )
      )
      .returning({ id: printOrders.id });

    console.log("[cron/cleanup-stale-orders] cancelled stale orders", {
      count: cancelled.length,
      cutoff: cutoff.toISOString(),
    });

    return Response.json({
      cancelled: cancelled.length,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    logError("cron/cleanup-stale-orders", error);
    return Response.json(
      { error: "Cleanup failed" },
      { status: 500 }
    );
  }
}
