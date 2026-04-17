import { headers } from "next/headers";
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

  if (isPaidCheckout || isAsyncSuccess) {
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
  }

  return Response.json({ received: true });
}
