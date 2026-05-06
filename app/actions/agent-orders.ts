"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

const SESSION_CLAIM_PREFIX = "session_claim:";

/**
 * Confirms an agent-initiated print order: flips its status from
 * `awaiting_agent_approval` to `cart_created`, mints a Stripe Checkout
 * session against the saved shipping address, and returns the
 * checkout URL.
 *
 * Auth model: the user must be signed in to the Materialize account
 * that owns the order. The unguessable confirmation token (passed
 * through the email URL) is validated alongside the userId match —
 * both must agree before we mint the session.
 *
 * After this action returns, the regular Stripe flow takes over:
 * webhook fires on payment success, places the CraftCloud order via
 * the existing handlePrintOrderPayment claim pattern.
 */
export async function confirmAgentInitiatedOrder(input: {
  orderId: string;
  confirmationToken: string;
}): Promise<{ checkoutUrl: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return { error: "Sign in required" };
    }

    const [order] = await db
      .select()
      .from(printOrders)
      .where(
        and(
          eq(printOrders.id, input.orderId),
          eq(printOrders.userId, userId)
        )
      )
      .limit(1);

    if (!order) return { error: "Order not found" };
    if (order.status !== "awaiting_agent_approval") {
      return { error: "This order is no longer awaiting approval" };
    }
    if (order.confirmationToken !== input.confirmationToken) {
      return { error: "Invalid confirmation link" };
    }
    if (
      order.confirmationExpiresAt &&
      order.confirmationExpiresAt.getTime() < Date.now()
    ) {
      return { error: "This confirmation link has expired" };
    }
    if (!order.shippingAddress?.email) {
      return { error: "Order is missing shipping email" };
    }

    const sentinel = `${SESSION_CLAIM_PREFIX}${nanoid()}`;
    const claimed = await db
      .update(printOrders)
      .set({
        stripeSessionId: sentinel,
        status: "cart_created",
      })
      .where(
        and(
          eq(printOrders.id, input.orderId),
          eq(printOrders.userId, userId),
          eq(printOrders.status, "awaiting_agent_approval"),
          isNull(printOrders.stripeSessionId)
        )
      )
      .returning({ id: printOrders.id });

    if (claimed.length === 0) {
      return {
        error: "Confirmation already in progress. Please refresh and try again.",
      };
    }

    let sessionResult: { id: string; url: string } | { error: string };
    try {
      sessionResult = await mintStripeSession({
        order: { ...order, status: "cart_created" },
        email: order.shippingAddress.email,
      });
    } catch (err) {
      await db
        .update(printOrders)
        .set({ stripeSessionId: null, status: "awaiting_agent_approval" })
        .where(
          and(
            eq(printOrders.id, input.orderId),
            eq(printOrders.stripeSessionId, sentinel)
          )
        );
      throw err;
    }

    if ("error" in sessionResult) {
      await db
        .update(printOrders)
        .set({ stripeSessionId: null, status: "awaiting_agent_approval" })
        .where(
          and(
            eq(printOrders.id, input.orderId),
            eq(printOrders.stripeSessionId, sentinel)
          )
        );
      return { error: sessionResult.error };
    }

    await db
      .update(printOrders)
      .set({ stripeSessionId: sessionResult.id })
      .where(
        and(
          eq(printOrders.id, input.orderId),
          eq(printOrders.stripeSessionId, sentinel)
        )
      );

    return { checkoutUrl: sessionResult.url };
  } catch (error) {
    logError("confirmAgentInitiatedOrder", error);
    return { error: "Failed to confirm order. Please try again." };
  }
}

async function mintStripeSession(params: {
  order: typeof printOrders.$inferSelect;
  email: string;
}): Promise<{ id: string; url: string } | { error: string }> {
  const { order, email } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let fileDisplayName: string | null = null;
  if (order.fileAssetId) {
    const [a] = await db
      .select({
        name: files.name,
        original: fileAssets.originalFilename,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, order.fileAssetId))
      .limit(1);
    fileDisplayName =
      a?.name ?? a?.original?.replace(/\.[^.]+$/, "") ?? null;
  }

  const [materialEntry, provider] = await Promise.all([
    order.material ? findMaterialConfig(order.material).catch(() => null) : null,
    order.vendor && !order.vendorName
      ? findProvider(order.vendor).catch(() => null)
      : null,
  ]);
  const vendorName = order.vendorName ?? provider?.name ?? null;
  const description = [
    [materialEntry?.material.name, materialEntry?.config.color]
      .filter(Boolean)
      .join(" "),
    materialEntry?.finishGroup.name,
    vendorName ? `by ${vendorName}` : null,
  ]
    .filter((s): s is string => Boolean(s && s.length))
    .join(" · ");

  const lineItems: Array<{
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
    quantity: number;
  }> = [];

  if (
    order.materialSubtotal != null &&
    order.shippingSubtotal != null &&
    order.quantity != null
  ) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: order.materialSubtotal,
        product_data: {
          name: `3D Print — ${fileDisplayName ?? "Untitled"}`,
          ...(description ? { description } : {}),
        },
      },
      quantity: order.quantity,
    });

    const productionFee =
      order.totalPrice -
      (order.materialSubtotal * order.quantity + order.shippingSubtotal);
    if (productionFee > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: productionFee,
          product_data: {
            name: "Vendor minimum production fee",
            description:
              "Additional charge to meet this vendor's minimum production requirement",
          },
        },
        quantity: 1,
      });
    }

    if (order.shippingSubtotal > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: order.shippingSubtotal,
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
          name: `3D Print — ${fileDisplayName ?? "Untitled"}`,
          ...(description ? { description } : {}),
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
    customer_email: email,
    line_items: lineItems,
    payment_intent_data: {
      metadata: { printOrderId: order.id },
    },
    metadata: {
      printOrderId: order.id,
      type: "print_order",
      source: "agent",
    },
    success_url: `${appUrl}/dashboard/orders?payment=success&orderId=${order.id}`,
    cancel_url: `${appUrl}/orders/${order.id}/confirm?payment=cancelled`,
  });

  if (!session.url) {
    return { error: "Stripe returned no checkout URL" };
  }
  return { id: session.id, url: session.url };
}
