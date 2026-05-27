"use server";

import { auth } from "@clerk/nextjs/server";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  printOrders,
  fileAssets,
  files,
  tokenSpendingLedger,
} from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { sendCancellationConfirmedEmail } from "@/lib/mcp/email";
import { logError } from "@/lib/logger";
import { revalidatePath } from "next/cache";

const SESSION_CLAIM_PREFIX = "session_claim:";

// Constant-time comparison of the emailed confirm/cancel capability token.
// Hashing first equalizes length (timingSafeEqual throws on length mismatch)
// and a null/absent stored token never matches.
function confirmationTokenMatches(
  stored: string | null | undefined,
  provided: string | null | undefined
): boolean {
  if (!stored || !provided) return false;
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

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
    if (!confirmationTokenMatches(order.confirmationToken, input.confirmationToken)) {
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

/**
 * Cancels an auto-approved agent order during its cancellation
 * window. Refunds the PaymentIntent, transitions the order to
 * `cancelled`, and removes the spending-ledger row so the user's
 * period budget is restored.
 *
 * Auth: Clerk session + ownership match + the unguessable
 * confirmation token (passed through the cancel URL in the email)
 * — same pattern as confirmAgentInitiatedOrder.
 *
 * Time gate: status must still be `auto_approved` AND
 * `autoApprovedUntil > now`. After the window closes the cron has
 * already (or is about to) place the CraftCloud order; refunds
 * after that point go through the existing dispute/refund flow.
 *
 * Idempotency: the atomic `auto_approved → cancelled` UPDATE means
 * only the first concurrent caller wins. Subsequent duplicate calls
 * see 0 rows updated and return "already cancelled".
 */
export async function cancelAutoApprovedOrder(input: {
  orderId: string;
  confirmationToken: string;
}): Promise<{ ok: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Sign in required" };

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
    if (!confirmationTokenMatches(order.confirmationToken, input.confirmationToken)) {
      return { error: "Invalid cancel link" };
    }
    if (order.status !== "auto_approved") {
      return {
        error:
          order.status === "cancelled"
            ? "Order is already cancelled"
            : "This order can no longer be cancelled — fulfillment has started",
      };
    }
    if (
      !order.autoApprovedUntil ||
      order.autoApprovedUntil.getTime() <= Date.now()
    ) {
      return {
        error:
          "Cancellation window has closed — the order is being placed with the print vendor",
      };
    }

    // Atomic transition. The status guard is the dedup primitive —
    // a concurrent cron sweep flipping the row to cart_created will
    // make this UPDATE return 0 rows.
    const claimed = await db
      .update(printOrders)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(printOrders.id, input.orderId),
          eq(printOrders.userId, userId),
          eq(printOrders.status, "auto_approved"),
          gt(printOrders.autoApprovedUntil, new Date())
        )
      )
      .returning({ id: printOrders.id });

    if (claimed.length === 0) {
      return {
        error:
          "Cancellation window just closed. The order is being placed; refunds are available on your dashboard.",
      };
    }

    // Refund the PaymentIntent. We stored the id in stripeSessionId
    // (reused column — see createAgentInitiatedOrder for context).
    if (order.stripeSessionId) {
      try {
        const stripe = getStripe();
        await stripe.refunds.create(
          {
            payment_intent: order.stripeSessionId,
            reason: "requested_by_customer",
            metadata: { printOrderId: order.id, source: "agent_auto_cancel" },
          },
          // Deterministic key so a retry (manual or a future reconciliation
          // sweep) can't issue a second refund. NOTE: the failure path here
          // still only logs — it does not yet persist a retry marker, so a
          // failed refund leaves the order cancelled-but-charged. Tracked in
          // CON-44; needs a schema field + sweep (human review).
          { idempotencyKey: `agent-cancel-refund:${order.id}` }
        );
      } catch (err) {
        // The order is already cancelled in our DB — log the refund
        // failure but don't roll back. The user can still get their
        // money back via Stripe's dispute flow if needed.
        logError("cancelAutoApprovedOrder.refund", err);
      }
    }

    // Remove the spending-ledger row so the period budget reflects
    // the cancellation. Best-effort — even if this fails the
    // budget will reset at the next period boundary.
    try {
      await db
        .delete(tokenSpendingLedger)
        .where(eq(tokenSpendingLedger.printOrderId, order.id));
    } catch (err) {
      logError("cancelAutoApprovedOrder.ledger", err);
    }

    // Best-effort confirmation email — failure is logged but doesn't
    // affect the cancellation success that the UI just confirmed.
    sendCancellationConfirmedEmail({ orderId: order.id }).catch((err) =>
      logError("cancelAutoApprovedOrder.confirmationEmail", err)
    );

    revalidatePath("/dashboard/orders");
    return { ok: true };
  } catch (error) {
    logError("cancelAutoApprovedOrder", error);
    return { error: "Failed to cancel. Please try again." };
  }
}
