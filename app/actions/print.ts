"use server";

/**
 * Server actions for the print-order pipeline.
 *
 * Flow: createPrintOrder → completePrintOrder → Stripe checkout →
 * stripe webhook → CraftCloud order placement.
 *
 *   createPrintOrder(quote, shipping, quantity, material, vendor)
 *     - Validates via printOrderSchema.
 *     - Creates a CraftCloud cart (real API call, costs time).
 *     - Inserts a printOrders row in status "cart_created".
 *
 *   completePrintOrder(orderId, email, shipping, billing, isAnonFlow?)
 *     - Validates the address via checkoutAddressSchema.
 *     - Creates a Stripe Checkout session for totalPrice + 3% fee.
 *     - Stores stripeSessionId + shippingAddress on the printOrder.
 *     - Returns { checkoutUrl } for the client to window.location to.
 *     - isAnonFlow swaps the success redirect to /dashboard/orders?welcome=1
 *
 * The CraftCloud order itself is NOT placed here — that happens in
 * app/api/webhooks/stripe/route.ts after the payment clears. See
 * that file for the idempotency invariants.
 *
 * SERVICE_FEE_RATE is our cut. Do not hardcode elsewhere.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createCart, getOrderStatus } from "@/lib/craftcloud/client";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
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

    const materialSubtotal = Math.round(data.materialPrice * 100);
    const shippingSubtotal = Math.round(data.shippingPrice * 100);
    const totalPrice = materialSubtotal * data.quantity + shippingSubtotal;
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
        materialSubtotal,
        shippingSubtotal,
        quantity: data.quantity,
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

/**
 * Builds the Stripe Checkout session for a printOrders row. Shared
 * between the initial checkout (completePrintOrder) and the
 * Resume-cart path (resumePrintOrder), so both flows emit the same
 * success/cancel URLs and the same line-item shape.
 *
 * The success + cancel URLs intentionally route through the
 * /dashboard/orders redirector (not a deep link to a single order)
 * so users whose Clerk session cookie is still settling after the
 * inline OTP signup don't get bounced to /sign-in by middleware.
 */
async function createStripeSessionForOrder(
  order: typeof printOrders.$inferSelect,
  opts: { email: string; isAnonFlow: boolean }
): Promise<{ id: string; url: string } | { error: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Resolve human-readable names for the Stripe line items. The
  // printOrders row only stores UUIDs (materialConfigId, vendorId)
  // and a fileAssetId — without this join the checkout page just
  // shows "3D Print Order — 4f0d1d2b-..." which means nothing to
  // the buyer. Catalog lookups are 24h-cached, file join is cheap.
  const [assetRow] = await db
    .select({
      fileName: files.name,
      originalFilename: fileAssets.originalFilename,
    })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, order.fileAssetId))
    .limit(1);

  const [materialEntry, provider] = await Promise.all([
    order.material ? findMaterialConfig(order.material) : null,
    order.vendor ? findProvider(order.vendor) : null,
  ]);

  const fileDisplayName =
    assetRow?.fileName ??
    assetRow?.originalFilename?.replace(/\.[^.]+$/, "") ??
    "3D Print";
  const materialName = materialEntry?.material.name ?? null;
  const finishName = materialEntry?.finishGroup.name ?? null;
  const colorName = materialEntry?.config.color ?? null;
  const vendorName = provider?.name ?? null;

  const descriptionParts = [
    [materialName, colorName].filter(Boolean).join(" "),
    finishName,
    vendorName ? `by ${vendorName}` : null,
  ].filter((s): s is string => Boolean(s && s.length));
  const printDescription =
    descriptionParts.length > 0 ? descriptionParts.join(" · ") : undefined;

  // Prefer the persisted breakdown when present so Stripe shows the
  // print / shipping split. Older rows (pre-breakdown columns) fall
  // back to a single Print line item for backwards compatibility.
  const hasBreakdown =
    order.materialSubtotal != null &&
    order.shippingSubtotal != null &&
    order.quantity != null;

  type LineItem = {
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
    quantity: number;
  };
  const lineItems: LineItem[] = [];

  if (hasBreakdown) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: order.materialSubtotal!,
        product_data: {
          name: `3D Print — ${fileDisplayName}`,
          ...(printDescription ? { description: printDescription } : {}),
        },
      },
      quantity: order.quantity!,
    });
    if (order.shippingSubtotal! > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: order.shippingSubtotal!,
          product_data: { name: "Shipping" },
        },
        quantity: 1,
      });
    }
  } else {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: order.totalPrice,
        product_data: {
          name: `3D Print — ${fileDisplayName}`,
          ...(printDescription ? { description: printDescription } : {}),
        },
      },
      quantity: 1,
    });
  }

  lineItems.push({
    price_data: {
      currency: "usd",
      unit_amount: order.serviceFee,
      product_data: {
        name: "Service fee",
        description: "Materialize platform fee (3%)",
      },
    },
    quantity: 1,
  });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: opts.email,
    line_items: lineItems,
    payment_intent_data: {
      metadata: { printOrderId: order.id },
    },
    metadata: {
      printOrderId: order.id,
      type: "print_order",
    },
    success_url: `${appUrl}/dashboard/orders?${opts.isAnonFlow ? "welcome=1&" : ""}payment=success&orderId=${order.id}`,
    cancel_url: `${appUrl}/dashboard/orders?payment=cancelled&orderId=${order.id}`,
  });

  if (!session.url) {
    logError("createStripeSessionForOrder.missingSessionUrl", {
      sessionId: session.id,
      orderId: order.id,
    });
    return { error: "Payment provider returned no checkout URL." };
  }

  return { id: session.id, url: session.url };
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

    const sessionResult = await createStripeSessionForOrder(order, {
      email: params.email,
      isAnonFlow: params.isAnonFlow ?? false,
    });
    if ("error" in sessionResult) return { error: sessionResult.error };

    // Store address + Stripe session for deferred CraftCloud order placement
    await db
      .update(printOrders)
      .set({
        stripeSessionId: sessionResult.id,
        shippingAddress: {
          email: params.email,
          shipping: params.shipping,
          billing: params.billing,
        },
      })
      .where(eq(printOrders.id, params.orderId));

    revalidatePath("/dashboard/orders");
    return { checkoutUrl: sessionResult.url };
  } catch (error) {
    logError("completePrintOrder", error);
    return { error: "Failed to create checkout. Please try again." };
  }
}

/**
 * Resume a cart_created print order: reuse the existing Stripe
 * Checkout session when it's still open (they live 24h), otherwise
 * mint a fresh one from the stored address + line items. Used by
 * the Resume button on the dashboard carts list so a user who
 * bailed on Stripe lands back on payment in one click instead of
 * re-walking the material picker.
 */
export async function resumePrintOrder(
  orderId: string
): Promise<{ checkoutUrl: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [order] = await db
      .select()
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

    if (!order) return { error: "Order not found" };
    if (order.status !== "cart_created") {
      return { error: "Order already processed" };
    }
    if (!order.shippingAddress?.email) {
      // Never made it past the address step — can't rebuild a
      // session without an email. Caller should fall back to the
      // material-picker entry point.
      return { error: "Order has no saved address" };
    }

    const stripe = getStripe();

    if (order.stripeSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          order.stripeSessionId
        );
        if (existing.status === "open" && existing.url) {
          return { checkoutUrl: existing.url };
        }
      } catch (error) {
        // Fall through to re-create on any retrieval failure.
        logError("resumePrintOrder.retrieve", error);
      }
    }

    const sessionResult = await createStripeSessionForOrder(order, {
      email: order.shippingAddress.email,
      isAnonFlow: false,
    });
    if ("error" in sessionResult) return { error: sessionResult.error };

    await db
      .update(printOrders)
      .set({ stripeSessionId: sessionResult.id })
      .where(eq(printOrders.id, orderId));

    return { checkoutUrl: sessionResult.url };
  } catch (error) {
    logError("resumePrintOrder", error);
    return { error: "Failed to resume order. Please try again." };
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
