import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { handlePrintOrderPayment } from "@/lib/stripe/handle-print-order-payment";
import { logError } from "@/lib/logger";

/**
 * Places CraftCloud orders for auto-approved agent orders whose
 * cancellation window has expired.
 *
 * Lifecycle:
 *
 *   createAgentInitiatedOrder (within policy)
 *     → off-session PaymentIntent succeeds
 *     → printOrder.status = 'auto_approved'
 *     → autoApprovedUntil = now + cancellation_window_minutes
 *
 *   This cron, every minute:
 *     → SELECT auto_approved orders with autoApprovedUntil <= now
 *     → atomically transition to 'cart_created'
 *     → call handlePrintOrderPayment (the same handler used by the
 *        Stripe checkout webhook)
 *
 * The atomic transition is what makes this safe across overlapping
 * cron invocations: the UPDATE only succeeds for one worker per
 * order, so handlePrintOrderPayment runs exactly once per row.
 *
 * On handler failure we log and return a non-200 so Vercel's cron
 * monitoring surfaces it. The order stays in `cart_created` (the
 * handler is itself idempotent — the next run will retry).
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/place-auto-approved-orders
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    // Atomically claim all due rows by flipping them to
    // cart_created. The handler we call below requires that exact
    // status, so a row not returned here (because someone else
    // claimed it) is also a row we won't redundantly place.
    const claimed = await db
      .update(printOrders)
      .set({ status: "cart_created" })
      .where(
        and(
          eq(printOrders.status, "auto_approved"),
          lte(printOrders.autoApprovedUntil, now)
        )
      )
      .returning({ id: printOrders.id });

    // Worker pool of CONCURRENCY against CraftCloud — same pattern
    // as sweep-fingerprint-stragglers/route.ts. Strictly serial used
    // to be the safe default (one CraftCloud failure surfaces before
    // we trigger the next call), but the handler is already
    // idempotent and self-logs, so the safety argument was thin.
    // Bounded parallel keeps CraftCloud rate-limit pressure under
    // control while letting a backlog of 20+ orders drain inside the
    // function's wall-clock budget instead of timing out.
    const CONCURRENCY = 4;
    let placed = 0;
    let failed = 0;
    let idx = 0;
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= claimed.length) return;
        const { id } = claimed[i];
        try {
          await handlePrintOrderPayment(id);
          placed += 1;
        } catch (error) {
          logError("cron/place-auto-approved-orders.handler", error);
          failed += 1;
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, claimed.length) },
        () => worker()
      )
    );

    const result = { claimed: claimed.length, placed, failed };
    console.log("[cron/place-auto-approved-orders] swept", result);

    if (failed > 0) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    logError("cron/place-auto-approved-orders", error);
    return Response.json(
      { error: "Sweep failed" },
      { status: 500 }
    );
  }
}
