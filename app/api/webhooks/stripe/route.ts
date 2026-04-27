import { headers } from "next/headers";
import { db } from "@/lib/db";
import { webhookEventsProcessed } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { handlePrintOrderPayment } from "@/lib/stripe/handle-print-order-payment";
import { logError } from "@/lib/logger";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logError("stripe-webhook", "STRIPE_WEBHOOK_SECRET not configured");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logError("stripe-webhook-verify", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // We place the CraftCloud order on two events:
  //   - checkout.session.completed WITH payment_status === "paid"
  //     (card + synchronous rails — the common path).
  //   - checkout.session.async_payment_succeeded (ACH, SEPA, any
  //     delayed rail where "completed" fires before payment
  //     confirms). Stripe's docs call this out explicitly.
  // Both events carry the same session + metadata shape. The
  // handler is idempotent, so if both fire for the same order we
  // only place it once.
  const isPaidCheckout =
    event.type === "checkout.session.completed" &&
    (event.data.object as Stripe.Checkout.Session).payment_status === "paid";
  const isAsyncSuccess = event.type === "checkout.session.async_payment_succeeded";
  const isHandled = isPaidCheckout || isAsyncSuccess;

  // Defense-in-depth dedup — the inner handlePrintOrderPayment also
  // claims atomically against the printOrders row, but recording the
  // Stripe event id here lets us no-op duplicate deliveries before
  // any DB or CraftCloud work fires. Only events we actually handle
  // are recorded; the table grows in proportion to real work, not
  // every Stripe event type. We check FIRST and INSERT after success
  // so transient handler failures still get retried by Stripe — the
  // ack on a duplicate happens only if the prior delivery committed.
  if (isHandled) {
    const [existing] = await db
      .select({ id: webhookEventsProcessed.id })
      .from(webhookEventsProcessed)
      .where(eq(webhookEventsProcessed.id, event.id))
      .limit(1);
    if (existing) {
      return Response.json({ received: true, duplicate: true });
    }
  }

  if (isHandled) {
    const session = event.data.object as Stripe.Checkout.Session;
    const printOrderId = session.metadata?.printOrderId;

    if (printOrderId && session.metadata?.type === "print_order") {
      try {
        await handlePrintOrderPayment(printOrderId);
      } catch (error) {
        logError("stripe-webhook-handler", error);
        // Return 500 so Stripe retries — the user paid, we MUST place the order
        return Response.json(
          { error: "Failed to process order" },
          { status: 500 }
        );
      }
    }

    // Mark the event processed only after the handler succeeded (or
    // was correctly no-op'd because metadata didn't match a known
    // shape). ON CONFLICT DO NOTHING absorbs the rare double-insert
    // when two near-simultaneous deliveries both pass the SELECT.
    try {
      await db
        .insert(webhookEventsProcessed)
        .values({ id: event.id, eventType: event.type })
        .onConflictDoNothing();
    } catch (err) {
      // Don't fail the webhook on dedup-table issues — handler
      // succeeded, the user paid, the order is placed. A missed
      // dedup row at worst means we re-run on the next retry
      // (handler is itself idempotent).
      logError("stripe-webhook-dedup-insert", err);
    }
  }

  return Response.json({ received: true });
}
