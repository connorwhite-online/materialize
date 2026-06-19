import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { and, eq, isNull, like, lte, or } from "drizzle-orm";
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
 * Retry semantics for stuck charged rows (CON-159):
 *   If handlePrintOrderPayment throws (e.g. CraftCloud 500), the
 *   handler releases its claim sentinel and the row stays in
 *   `cart_created` with the off-session PI id in stripeSessionId.
 *   The next invocation's WHERE includes a second OR-branch that
 *   re-claims these stuck rows so they get retried. Without this
 *   widening, the row would stay `cart_created` indefinitely until
 *   cleanup-stale-orders cancels it — WITHOUT issuing a refund.
 *
 * On handler failure we log and return a non-200 so Vercel's cron
 * monitoring surfaces it.
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

  // Agent-initiated ordering (CON-152) is experimental and OFF by
  // default (MATERIALIZE_AGENT_BILLING_ENABLED). When it's off, no
  // order can ever reach `auto_approved` (the auto path is gated on
  // the same switch), so this sweep has nothing to do — return before
  // touching the database. This matters for cost: a per-minute cron
  // that queries Neon on every tick prevents the database from
  // scaling to zero and burns the entire free-tier compute quota.
  // The schedule is also removed from vercel.json while the feature
  // is dark; this guard makes re-adding it safe (it self-resumes the
  // moment the switch is flipped on).
  if (process.env.MATERIALIZE_AGENT_BILLING_ENABLED !== "true") {
    return Response.json({ skipped: "agent billing disabled" });
  }

  try {
    const now = new Date();

    // Phase 1: Atomically claim all due rows by flipping them to
    // cart_created. The handler we call below requires that exact
    // status, so a row not returned here (because someone else
    // claimed it) is also a row we won't redundantly place.
    const freshClaimed = await db
      .update(printOrders)
      .set({ status: "cart_created" })
      .where(
        and(
          eq(printOrders.status, "auto_approved"),
          lte(printOrders.autoApprovedUntil, now)
        )
      )
      .returning({ id: printOrders.id });

    // Phase 2 (CON-159): Reclaim stuck charged rows. If a previous
    // run's handler threw after CraftCloud call (e.g. 500), it
    // released the claim sentinel and the row stayed in `cart_created`
    // with the off-session PaymentIntent id still in stripeSessionId.
    // The cleanup cron would cancel such rows WITHOUT refunding the
    // customer. Reclaim them here so they get retried.
    //
    // Safety: handlePrintOrderPayment's own atomic claim (gated on
    // craftCloudOrderId IS NULL) prevents double-placement even if
    // multiple cron invocations overlap on the same row.
    const stuckClaimed = await db
      .select({ id: printOrders.id })
      .from(printOrders)
      .where(
        and(
          eq(printOrders.status, "cart_created"),
          like(printOrders.stripeSessionId, "pi_%"),
          isNull(printOrders.craftCloudOrderId)
        )
      );

    // Deduplicate in case a row just transitioned auto_approved →
    // cart_created in phase 1 (it will also match phase 2's WHERE).
    const freshIds = new Set(freshClaimed.map((r) => r.id));
    const retryIds = stuckClaimed
      .map((r) => r.id)
      .filter((id) => !freshIds.has(id));

    const claimed = [
      ...freshClaimed,
      ...retryIds.map((id) => ({ id })),
    ];

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

    const result = {
      claimed: claimed.length,
      freshClaimed: freshClaimed.length,
      retriedStuck: retryIds.length,
      placed,
      failed,
    };
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
