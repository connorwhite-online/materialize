"use server";

import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { isMockCheckoutMode } from "@/lib/craftcloud/client";
import { getStripe } from "@/lib/stripe";
import { captureFeeAndPlaceOrder } from "@/lib/stripe/reconcile-production-payments";
import { logError } from "@/lib/logger";

/**
 * "Pay" on the sandbox CraftCloud checkout (app/sandbox/craftcloud-pay)
 * — mock checkout mode's stand-in for the customer completing
 * CraftCloud's hosted production payment. It performs, synchronously,
 * exactly what the hourly reconcile cron does when it observes a
 * confirmed live payment: capture the held service fee and advance the
 * order to `ordered` (via the shared captureFeeAndPlaceOrder), so the
 * sandbox flow ends with immediate, visible confirmation instead of an
 * order that lingers at "Complete payment" until the next sweep.
 *
 * Hard-gated on isMockCheckoutMode() so the action is inert when
 * checkout runs against the real CraftCloud API.
 */
export async function paySandboxProductionOrder(
  orderId: string
): Promise<{ redirectUrl: string } | { error: string }> {
  try {
    if (!isMockCheckoutMode()) {
      return { error: "Sandbox payments are disabled." };
    }

    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [order] = await db
      .select({
        id: printOrders.id,
        status: printOrders.status,
        checkoutModel: printOrders.checkoutModel,
        feePaymentIntentId: printOrders.feePaymentIntentId,
      })
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)))
      .limit(1);

    if (!order || order.checkoutModel !== "two_step") {
      return { error: "Order not found" };
    }

    const paidUrl = `/dashboard/orders?production=paid&orderId=${order.id}`;

    // Already advanced (double tap, webhook race) — idempotent success.
    if (order.status === "ordered") {
      return { redirectUrl: paidUrl };
    }
    if (order.status !== "awaiting_production_payment") {
      return { error: "This order isn't awaiting production payment." };
    }
    if (!order.feePaymentIntentId) {
      return { error: "No service-fee authorization found for this order." };
    }

    const intent = await getStripe().paymentIntents.retrieve(
      order.feePaymentIntentId
    );

    if (intent.status === "succeeded") {
      // Fee already captured but the row lagged — heal, same as the
      // reconcile sweep's already-captured branch.
      await db
        .update(printOrders)
        .set({ status: "ordered", feeCapturedAt: new Date() })
        .where(
          and(
            eq(printOrders.id, order.id),
            eq(printOrders.status, "awaiting_production_payment")
          )
        );
    } else if (intent.status === "requires_capture") {
      await captureFeeAndPlaceOrder(order.id, order.feePaymentIntentId);
    } else if (intent.status === "canceled") {
      return {
        error:
          "The service-fee hold on this order expired, so it can't be completed. Start a new print from your orders page.",
      };
    } else {
      return {
        error: `Service fee is in an unexpected state (${intent.status}). Try again in a moment.`,
      };
    }

    revalidatePath("/dashboard/orders");
    return { redirectUrl: paidUrl };
  } catch (error) {
    logError("paySandboxProductionOrder", error);
    return { error: "Sandbox payment failed. Please try again." };
  }
}
