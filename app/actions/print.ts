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

const SERVICE_FEE_RATE = 0.08;

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

    // Create Craft Cloud cart
    const cart = await createCart({
      shippingIds: [data.shippingId],
      currency: data.currency,
      quotes: [
        {
          quoteId: data.quoteId,
          vendorId: data.vendorId,
          modelId: "",
          materialConfigId: data.materialConfigId,
          quantity: data.quantity,
        },
      ],
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
    return { error: "Failed to create print order. Please try again." };
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
      success_url: `${appUrl}/dashboard/orders/${params.orderId}?payment=success`,
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

    revalidatePath("/dashboard/orders");
    return { checkoutUrl: session.url! };
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

    // Only allow refunds for blocked or ordered status
    if (order.status !== "blocked" && order.status !== "ordered") {
      return { error: "This order cannot be refunded at this stage" };
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
