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
import { printOrders, printOrderItems, cartItems, fileAssets, files } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createCart, getOrderStatus } from "@/lib/craftcloud/client";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { getStripe } from "@/lib/stripe";
import { printOrderSchema } from "@/lib/validations/print";
import { checkoutAddressSchema } from "@/lib/validations/address";
import { logError } from "@/lib/logger";
import type { Currency } from "@/lib/craftcloud/types";

const SERVICE_FEE_RATE = 0.03;

/**
 * Lightweight check for vendor minimum production prices. Creates a
 * CraftCloud cart (free, disposable reservation) purely to inspect
 * the `minimumProductionPrice` field — no DB writes, no auth needed.
 *
 * Called from the QuoteConfigurator after the user selects a quote +
 * shipping, so the PriceDisplay can show the true total before
 * checkout. The actual checkout flow in `createPrintOrder` /
 * `checkoutVendorGroup` re-creates its own cart and applies the same
 * adjustment, so this check is informational only.
 */
export async function checkCartPricing(params: {
  quoteId: string;
  vendorId: string;
  shippingId: string;
  currency: Currency;
}): Promise<
  | { minimumProductionFee: number; vendorMinimumPrice: number }
  | { error: string }
> {
  try {
    const cart = await createCart({
      shippingIds: [params.shippingId],
      currency: params.currency,
      quotes: [{ id: params.quoteId }],
    });

    const minimum = cart.minimumProductionPrice?.[params.vendorId];
    return {
      minimumProductionFee: minimum?.productionFee ?? 0,
      vendorMinimumPrice: minimum?.price ?? 0,
    };
  } catch (error) {
    logError("checkCartPricing", error);
    return { error: "Failed to check cart pricing" };
  }
}

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
  vendorName?: string;
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

    // Create Craft Cloud cart. The v5 API only wants { id: quoteId }
    // in each entry — the quote already encodes vendor, material,
    // model, and quantity by reference, so sending the full blob
    // trips additionalProperties: false and 400s.
    const cart = await createCart({
      shippingIds: [data.shippingId],
      currency: data.currency,
      quotes: [{ id: data.quoteId }],
    });

    // Check for vendor minimum production prices. Some vendors won't
    // start their machines below a threshold — CraftCloud adds a
    // `productionFee` to bridge the gap. Include it in our totals
    // so the Stripe charge matches what the user was shown.
    const minimum = cart.minimumProductionPrice?.[data.vendorId];
    const productionFeeCents = Math.round((minimum?.productionFee ?? 0) * 100);

    const materialSubtotal = Math.round(data.materialPrice * 100);
    const shippingSubtotal = Math.round(data.shippingPrice * 100);
    const totalPrice =
      materialSubtotal * data.quantity + productionFeeCents + shippingSubtotal;
    const serviceFee = Math.round(totalPrice * SERVICE_FEE_RATE);

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
        vendorName: data.vendorName ?? null,
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
    const vendorStatus =
      status.vendorStatuses.find((v) => v.vendorId === order.vendor) ??
      status.vendorStatuses[0];

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
 * Check out all cart items for a single vendor. Creates one
 * CraftCloud cart (with all the vendor's quote IDs), one printOrders
 * row, and one printOrderItems row per cart item. The cart items are
 * deleted after commitment. The caller should then run
 * completePrintOrder to create the Stripe session.
 */
export async function checkoutVendorGroup(
  vendorId: string
): Promise<{ orderId: string; cartId: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const items = await db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.userId, userId), eq(cartItems.vendorId, vendorId)));

    if (items.length === 0) return { error: "No items in cart for this vendor" };

    const shippingIds = [...new Set(items.map((i) => i.shippingId))];
    const currency = items[0].currency as Currency;

    const cart = await createCart({
      shippingIds,
      currency,
      quotes: items.map((i) => ({ id: i.quoteId })),
    });

    // Vendor minimum production fee — same logic as createPrintOrder.
    const minimum = cart.minimumProductionPrice?.[vendorId];
    const productionFeeCents = Math.round((minimum?.productionFee ?? 0) * 100);

    let totalPrice = 0;
    for (const item of items) {
      totalPrice += item.materialPrice * item.quantity + item.shippingPrice;
    }
    totalPrice += productionFeeCents;
    const serviceFee = Math.round(totalPrice * SERVICE_FEE_RATE);

    // All cart items were selected by vendorId, so the vendor name
    // (if any) is consistent across the group — pick the first
    // non-null to stamp on the order row for display.
    const resolvedVendorName =
      items.find((i) => i.vendorName)?.vendorName ?? null;

    const [order] = await db
      .insert(printOrders)
      .values({
        userId,
        fileAssetId: null,
        craftCloudCartId: cart.cartId,
        totalPrice,
        serviceFee,
        vendor: vendorId,
        vendorName: resolvedVendorName,
        status: "cart_created",
      })
      .returning();

    await db.insert(printOrderItems).values(
      items.map((i) => ({
        printOrderId: order.id,
        fileAssetId: i.fileAssetId,
        quoteId: i.quoteId,
        vendorId: i.vendorId,
        vendorName: i.vendorName ?? null,
        materialConfigId: i.materialConfigId,
        quantity: i.quantity,
        materialSubtotal: i.materialPrice,
        shippingSubtotal: i.shippingPrice,
      }))
    );

    await db
      .delete(cartItems)
      .where(
        inArray(
          cartItems.id,
          items.map((i) => i.id)
        )
      );

    revalidatePath("/dashboard/orders");
    return { orderId: order.id, cartId: cart.cartId };
  } catch (error) {
    logError("checkoutVendorGroup", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to checkout vendor group";
    return { error: message };
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
async function buildLineItemDescription(
  materialConfigId: string | null,
  vendorId: string | null,
  /**
   * Pre-resolved vendor name cached on the order/item row. When
   * present we skip the catalog round-trip — this is the default
   * path for orders created after the vendor_name migration.
   * Legacy rows pass null and fall back to findProvider lookup.
   */
  vendorName?: string | null
) {
  const [materialEntry, provider] = await Promise.all([
    materialConfigId ? findMaterialConfig(materialConfigId) : null,
    vendorName || !vendorId ? null : findProvider(vendorId),
  ]);
  const resolvedVendorName = vendorName || provider?.name || null;
  const parts = [
    [materialEntry?.material.name, materialEntry?.config.color].filter(Boolean).join(" "),
    materialEntry?.finishGroup.name,
    resolvedVendorName ? `by ${resolvedVendorName}` : null,
  ].filter((s): s is string => Boolean(s && s.length));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

type StripeLineItem = {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; description?: string };
  };
  quantity: number;
};

async function buildMultiItemLineItems(
  orderId: string,
  orderTotalPrice: number
): Promise<StripeLineItem[]> {
  const items = await db
    .select({
      fileName: files.name,
      originalFilename: fileAssets.originalFilename,
      materialConfigId: printOrderItems.materialConfigId,
      vendorId: printOrderItems.vendorId,
      vendorName: printOrderItems.vendorName,
      quantity: printOrderItems.quantity,
      materialSubtotal: printOrderItems.materialSubtotal,
      shippingSubtotal: printOrderItems.shippingSubtotal,
    })
    .from(printOrderItems)
    .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(printOrderItems.printOrderId, orderId));

  const lineItems: StripeLineItem[] = [];
  let totalShipping = 0;
  let totalMaterial = 0;

  for (const item of items) {
    const name = item.fileName ?? item.originalFilename?.replace(/\.[^.]+$/, "") ?? "3D Print";
    const description = await buildLineItemDescription(
      item.materialConfigId,
      item.vendorId,
      item.vendorName
    );
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: item.materialSubtotal,
        product_data: {
          name: `3D Print — ${name}`,
          ...(description ? { description } : {}),
        },
      },
      quantity: item.quantity,
    });
    totalMaterial += item.materialSubtotal * item.quantity;
    totalShipping += item.shippingSubtotal;
  }

  // Vendor minimum production fee for multi-item orders.
  const impliedProductionFee = orderTotalPrice - (totalMaterial + totalShipping);
  if (impliedProductionFee > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: impliedProductionFee,
        product_data: {
          name: "Vendor minimum production fee",
          description:
            "Additional charge to meet this vendor's minimum production requirement",
        },
      },
      quantity: 1,
    });
  }

  if (totalShipping > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: totalShipping,
        product_data: { name: "Shipping" },
      },
      quantity: 1,
    });
  }

  return lineItems;
}

async function createStripeSessionForOrder(
  order: typeof printOrders.$inferSelect,
  opts: { email: string; isAnonFlow: boolean }
): Promise<{ id: string; url: string } | { error: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const lineItems: StripeLineItem[] = [];

  if (!order.fileAssetId) {
    // Multi-item order — build line items from printOrderItems
    const itemLines = await buildMultiItemLineItems(order.id, order.totalPrice);
    lineItems.push(...itemLines);
  } else {
    // Legacy single-item order — build from the order row itself
    const [assetRow] = await db
      .select({
        fileName: files.name,
        originalFilename: fileAssets.originalFilename,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, order.fileAssetId))
      .limit(1);

    const description = await buildLineItemDescription(
      order.material,
      order.vendor,
      order.vendorName
    );

    const fileDisplayName =
      assetRow?.fileName ??
      assetRow?.originalFilename?.replace(/\.[^.]+$/, "") ??
      "3D Print";

    const hasBreakdown =
      order.materialSubtotal != null &&
      order.shippingSubtotal != null &&
      order.quantity != null;

    if (hasBreakdown) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: order.materialSubtotal!,
          product_data: {
            name: `3D Print — ${fileDisplayName}`,
            ...(description ? { description } : {}),
          },
        },
        quantity: order.quantity!,
      });

      // Vendor minimum production fee: the difference between the
      // stored totalPrice and the sum of material + shipping tells
      // us how much was added to meet the vendor's minimum. Show it
      // as a separate line so the Stripe receipt is transparent.
      const impliedProductionFee =
        order.totalPrice -
        (order.materialSubtotal! * order.quantity! + order.shippingSubtotal!);
      if (impliedProductionFee > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            unit_amount: impliedProductionFee,
            product_data: {
              name: "Vendor minimum production fee",
              description:
                "Additional charge to meet this vendor's minimum production requirement",
            },
          },
          quantity: 1,
        });
      }

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
            ...(description ? { description } : {}),
          },
        },
        quantity: 1,
      });
    }
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
