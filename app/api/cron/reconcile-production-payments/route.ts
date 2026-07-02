import { reconcileProductionPayments } from "@/lib/stripe/reconcile-production-payments";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";

/**
 * Hourly reconciliation sweep for two-step checkout orders (CON-118).
 *
 * Under `checkoutModel = "two_step"` our Stripe Checkout only puts a
 * HOLD on the 3% service fee (manual capture), and the customer pays
 * CraftCloud production + shipping directly at CraftCloud's hosted
 * Stripe session. CraftCloud has NO webhook to tell us that payment
 * happened, so polling is the only confirmation channel: this route
 * walks every `awaiting_production_payment` order, probes CraftCloud's
 * order status, and either
 *
 *   - captures the held fee + advances the order to `ordered`
 *     (CraftCloud payment confirmed),
 *   - cancels the hold + marks the order `cancelled` (abandoned past
 *     the 72h TTL — the customer is never charged), or
 *   - leaves it pending for the next sweep.
 *
 * See `lib/stripe/reconcile-production-payments.ts` for the full
 * decision table, including the self-healing branches for canceled /
 * already-captured PaymentIntents.
 *
 * Auth: when Vercel cron triggers this route it includes
 * `Authorization: Bearer ${CRON_SECRET}`. Without that header (or
 * with a wrong value) we 401.
 *
 * Wired in vercel.json (hourly). To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/reconcile-production-payments
 */

// Worst case: 500 rows (the SELECT's LIMIT) drained by a 4-worker pool
// (see reconcileProductionPayments), ~2 external calls per row (Stripe
// retrieve + CraftCloud getOrderStatus, sometimes + capture/cancel).
// ceil(500/4) * ~2.5s ≈ 315s; 300s covers the typical case with margin
// and matches the platform's default Pro-plan ceiling. Without this,
// Vercel silently kills the function past its default timeout with no
// log/Sentry event — see MTR-144. A backlog that still exceeds this is
// safe to leave for the next hourly run: every write is conditioned on
// the row's current status, so a mid-sweep kill never double-processes.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileProductionPayments();
    console.log("[cron/reconcile-production-payments] swept", result);
    if (result.errors > 0) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    logError("cron/reconcile-production-payments", error);
    return Response.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}
