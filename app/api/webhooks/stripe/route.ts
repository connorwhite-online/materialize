import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrder } from "@/lib/craftcloud/client";
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

  if (event.type === "checkout.session.completed") {
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

async function handlePrintOrderPayment(printOrderId: string) {
  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, printOrderId));

  if (!order) {
    throw new Error(`Print order not found: ${printOrderId}`);
  }

  // Idempotency guard #1: status has already advanced past
  // cart_created (webhook fired twice, first call committed).
  if (order.status !== "cart_created") {
    return;
  }

  // Idempotency guard #2: a CraftCloud order id is already on
  // record even though the status didn't flip to "ordered". This
  // is the partial-commit case — createOrder succeeded on a
  // previous call but the status update failed. Don't call
  // createOrder again; just fix the status and return.
  if (order.craftCloudOrderId) {
    await db
      .update(printOrders)
      .set({ status: "ordered" })
      .where(eq(printOrders.id, printOrderId));
    return;
  }

  if (!order.craftCloudCartId || !order.shippingAddress) {
    throw new Error(`Missing cart or address for order: ${printOrderId}`);
  }

  const addr = order.shippingAddress;

  // Place the CraftCloud order — if this fails, Stripe will retry the webhook
  const ccOrder = await createOrder({
    cartId: order.craftCloudCartId,
    user: {
      emailAddress: addr.email,
      shipping: addr.shipping,
      billing: addr.billing,
    },
  });

  await db
    .update(printOrders)
    .set({
      craftCloudOrderId: ccOrder.orderId,
      status: "ordered",
    })
    .where(eq(printOrders.id, printOrderId));
}
