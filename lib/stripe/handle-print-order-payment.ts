import "server-only";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrder } from "@/lib/craftcloud/client";

/**
 * Fires after a successful Stripe `checkout.session.completed`
 * event — the user has paid, and we need to place the real
 * CraftCloud order so production starts.
 *
 * Idempotency is critical here: Stripe retries webhooks on any
 * non-2xx response, and will also fire duplicate deliveries on
 * network hiccups. Two guards:
 *
 *   1. If `order.status !== "cart_created"` the previous call
 *      already advanced the state — this is a pure duplicate
 *      delivery, nothing to do.
 *   2. If `order.craftCloudOrderId` is set but the status is
 *      still "cart_created", the CraftCloud call succeeded on a
 *      previous attempt but the status-update commit failed.
 *      Heal the status WITHOUT calling createOrder again.
 *
 * Only after both guards have fallen through do we actually
 * place the CraftCloud order and write the result back.
 *
 * Throws on unrecoverable errors so the webhook route can return
 * 5xx and trigger a Stripe retry.
 */
export async function handlePrintOrderPayment(
  printOrderId: string
): Promise<void> {
  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, printOrderId));

  if (!order) {
    throw new Error(`Print order not found: ${printOrderId}`);
  }

  // Guard #1 — status already advanced past cart_created.
  if (order.status !== "cart_created") {
    return;
  }

  // Guard #2 — partial-commit recovery. CraftCloud order was
  // placed but the status update didn't land; heal the row
  // without re-placing.
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
