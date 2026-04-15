"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createCart, getOrderStatus } from "@/lib/craftcloud/client";
import { getStripe } from "@/lib/stripe";
import { printOrderSchema } from "@/lib/validations/print";
import { checkoutAddressSchema } from "@/lib/validations/address";
import { logError } from "@/lib/logger";
import type { Currency } from "@/lib/craftcloud/types";

const SERVICE_FEE_RATE = 0.03;

export async function discardDraftOrder(
  orderId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [order] = await db
      .select({ id: printOrders.id, status: printOrders.status })
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

    if (!order) return { error: "Order not found" };
    // Only drafts can be discarded — anything past cart_created is a
    // real order with a Stripe session / CraftCloud cart committed.
    if (order.status !== "cart_created") {
      return { error: "Cannot discard an order that has been placed" };
    }

    await db.delete(printOrders).where(eq(printOrders.id, orderId));

    revalidatePath("/dashboard/orders");
    return { success: true };
  } catch (error) {
    logError("discardDraftOrder", error);
    return { error: "Failed to discard draft" };
  }
}

export async function createPrintOrder(params: {
  fileAssetId: string;
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  shippingId: string;
  quantity: number;
  materialPrice: number;
  shippingPrice: number;
  currency: Currency;
}): Promise<{ orderId: string; cartId: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const parsed = printOrderSchema.safeParse(params);
    if (!parsed.success) {
      return { error: "Invalid order parameters" };
    }

    const data = parsed.data;

    const totalPrice = Math.round(
      (data.materialPrice * data.quantity + data.shippingPrice) * 100
    );
    const serviceFee = Math.round(totalPrice * SERVICE_FEE_RATE);

    // Create Craft Cloud cart. The v5 API only wants { id: quoteId }
    // in each entry — the quote already encodes vendor, material,
    // model, and quantity by reference, so sending the full blob
    // trips additionalProperties: false and 400s.
    const cart = await createCart({
      shippingIds: [data.shippingId],
      currency: data.currency,
      quotes: [{ id: data.quoteId }],
    });

    // Create print order record
    const [order] = await db
      .insert(printOrders)
      .values({
        userId,
        fileAssetId: data.fileAssetId,
        craftCloudCartId: cart.cartId,
        totalPrice,
        serviceFee,
        material: data.materialConfigId,
        vendor: data.vendorId,
        status: "cart_created",
      })
      .returning();

    revalidatePath("/dashboard/orders");
    return { orderId: order.id, cartId: cart.cartId };
  } catch (error) {
    logError("createPrintOrder", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create print order. Please try again.";
    return { error: message };
  }
}

export async function checkOrderStatus(
  orderId: string
): Promise<{ status: string } | null> {
  try {
    const { userId } = await auth();
    if (!userId) return null;

    const [order] = await db
      .select()
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

    if (!order || !order.craftCloudOrderId) return null;

    const status = await getOrderStatus(order.craftCloudOrderId);
    const vendorStatus = status.vendorStatuses[0];

    const STATUS_MAP: Record<string, typeof order.status> = {
      ordered: "ordered",
      in_production: "in_production",
      shipped: "shipped",
      received: "received",
      blocked: "blocked",
      cancelled: "cancelled",
    };

    if (vendorStatus && vendorStatus.status !== order.status) {
      const mappedStatus = STATUS_MAP[vendorStatus.status] || order.status;
      await db
        .update(printOrders)
        .set({
          status: mappedStatus,
          trackingInfo: vendorStatus.trackingUrl
            ? {
                trackingUrl: vendorStatus.trackingUrl,
                trackingNumber: vendorStatus.trackingNumber,
              }
            : undefined,
        })
        .where(eq(printOrders.id, orderId));

      revalidatePath(`/dashboard/orders/${orderId}`);
    }

    return { status: vendorStatus?.status || order.status };
  } catch (error) {
    logError("checkOrderStatus", error);
    return null;
  }
}

export async function completePrintOrder(params: {
  orderId: string;
  email: string;
  shipping: {
    firstName: string;
    lastName: string;
    address: string;
    addressLine2?: string;
    city: string;
    zipCode: string;
    stateCode?: string;
    countryCode: string;
    phoneNumber?: string;
  };
  billing: {
    firstName: string;
    lastName: string;
    address: string;
    addressLine2?: string;
    city: string;
    zipCode: string;
    stateCode?: string;
    countryCode: string;
    phoneNumber?: string;
    isCompany: boolean;
    vatId?: string;
  };
  /**
   * True when this checkout is the tail end of the anon-signup
   * flow (file picked on home or /print → email OTP → pay). We
   * send these users to the orders list with a welcome flag so
   * they land on the dashboard chrome and understand where their
   * orders live, instead of a deep-link into a single order page.
   */
  isAnonFlow?: boolean;
}): Promise<{ checkoutUrl: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    // Validate address
    const addressParsed = checkoutAddressSchema.safeParse({
      email: params.email,
      shipping: params.shipping,
      billingSameAsShipping: false,
      billing: params.billing,
    });
    if (!addressParsed.success) {
      return { error: "Invalid address information" };
    }

    // Fetch our print order, verify ownership and status
    const [order] = await db
      .select()
      .from(printOrders)
      .where(and(eq(printOrders.id, params.orderId), eq(printOrders.userId, userId)));

    if (!order) return { error: "Order not found" };
    if (order.status !== "cart_created") return { error: "Order already processed" };
    if (!order.craftCloudCartId) return { error: "No cart associated with order" };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const totalWithFee = order.totalPrice + order.serviceFee;

    // Create OUR Stripe Checkout session (not CraftCloud's)
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: params.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: totalWithFee,
            product_data: {
              name: `3D Print Order — ${order.material}`,
              description: `Quantity: ${order.vendor ? `Vendor: ${order.vendor}` : ""}`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          printOrderId: params.orderId,
        },
      },
      metadata: {
        printOrderId: params.orderId,
        type: "print_order",
      },
      success_url: params.isAnonFlow
        ? `${appUrl}/dashboard/orders?welcome=1&payment=success`
        : `${appUrl}/dashboard/orders/${params.orderId}?payment=success`,
      cancel_url: `${appUrl}/dashboard/orders/${params.orderId}?payment=cancelled`,
    });

    // Store address + Stripe session for deferred CraftCloud order placement
    await db
      .update(printOrders)
      .set({
        stripeSessionId: session.id,
        shippingAddress: {
          email: params.email,
          shipping: params.shipping,
          billing: params.billing,
        },
      })
      .where(eq(printOrders.id, params.orderId));

    if (!session.url) {
      logError("completePrintOrder.missingSessionUrl", {
        sessionId: session.id,
        orderId: params.orderId,
      });
      return { error: "Payment provider returned no checkout URL." };
    }

    revalidatePath("/dashboard/orders");
    return { checkoutUrl: session.url };
  } catch (error) {
    logError("completePrintOrder", error);
    return { error: "Failed to create checkout. Please try again." };
  }
}

export async function requestOrderRefund(
  orderId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [order] = await db
      .select()
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

    if (!order) return { error: "Order not found" };

    // Blocked = factory rejected, safe to refund immediately
    // Ordered = placed but not yet in production — check live status first
    // Anything else = too late for self-service refund
    if (order.status === "blocked") {
      // Factory rejected — refund is straightforward
    } else if (order.status === "ordered" && order.craftCloudOrderId) {
      // Check live status before allowing refund — it may have moved to production
      const liveStatus = await getOrderStatus(order.craftCloudOrderId);
      const vendorStatus = liveStatus.vendorStatuses[0];
      if (vendorStatus && vendorStatus.status !== "ordered") {
        // Already in production or beyond — can't refund self-service
        // Update our DB to reflect the real status
        const STATUS_MAP: Record<string, string> = {
          in_production: "in_production",
          shipped: "shipped",
          received: "received",
          blocked: "blocked",
          cancelled: "cancelled",
        };
        const mapped = STATUS_MAP[vendorStatus.status];
        if (mapped) {
          await db
            .update(printOrders)
            .set({ status: mapped as typeof order.status })
            .where(eq(printOrders.id, orderId));
          revalidatePath(`/dashboard/orders/${orderId}`);
        }
        return {
          error: "This order is already in production and can't be refunded automatically. Please contact support.",
        };
      }
    } else {
      return { error: "This order can't be refunded at this stage" };
    }

    if (!order.stripeSessionId) {
      return { error: "No payment found for this order" };
    }

    // Get the payment intent from the Stripe session
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);

    if (!session.payment_intent) {
      return { error: "No payment intent found" };
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    // Issue full refund
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
    });

    // Update order status
    await db
      .update(printOrders)
      .set({ status: "refunded" })
      .where(eq(printOrders.id, orderId));

    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/dashboard/orders");
    return { success: true };
  } catch (error) {
    logError("requestOrderRefund", error);
    return { error: "Failed to process refund. Please contact support." };
  }
}
