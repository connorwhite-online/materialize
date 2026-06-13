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
 * Under the "single" checkout model the CraftCloud order is NOT
 * placed here — that happens in app/api/webhooks/stripe/route.ts
 * after the payment clears. See that file for the idempotency
 * invariants. Under "two_step" (see printOrders.checkoutModel),
 * completePrintOrder places the CraftCloud order up-front (unpaid),
 * mints CraftCloud's hosted bridge session, and our Stripe session
 * only AUTHORIZES the 3% fee — captured later by the reconciliation
 * cron.
 *
 * Fee calculation lives in lib/fees.ts (calcServiceFee). Do not hardcode elsewhere.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders, printOrderItems, cartItems, fileAssets, files } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  createCart,
  createOrder,
  createStripeCheckout,
  getOrderStatus,
  CraftCloudApiError,
} from "@/lib/craftcloud/client";
import { getCheckoutModel, isSandboxMode } from "@/lib/env";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { getStripe } from "@/lib/stripe";
import { printOrderSchema } from "@/lib/validations/print";
import { checkoutAddressSchema } from "@/lib/validations/address";
import { logError } from "@/lib/logger";
import { userCanPrintAsset } from "@/lib/entitlement";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";
import type { Address, Currency } from "@/lib/craftcloud/types";
import { calcServiceFee } from "@/lib/fees";

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

/**
 * NOTE on checkoutModel: user-driven orders (this action +
 * checkoutVendorGroup) stamp the row with getCheckoutModel() at
 * creation time — the persisted column, not the env var, drives all
 * later lifecycle branching, so flipping CHECKOUT_MODEL never strands
 * in-flight orders. Agent/MCP-initiated orders (lib/mcp/**) are
 * intentionally NOT stamped and stay "single" via the column default:
 * they auto-charge a saved payment method with no customer present,
 * so there is nobody to walk through CraftCloud's hosted production
 * payment.
 */
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

    // Only the asset owner (or anyone, for a published listing) may
    // print it — blocks ordering another user's private/draft asset by
    // a guessed id. (CON-73)
    if (!(await userCanPrintAsset(userId, data.fileAssetId))) {
      return { error: "File not found" };
    }

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
    // Service fee is 3% of the pre-shipping subtotal — charging
    // a platform fee on freight would make our cut scale with
    // unrelated logistics costs. Shipping is still part of
    // totalPrice (it's money the user owes) but sits outside the
    // service-fee base.
    const preShippingTotal =
      materialSubtotal * data.quantity + productionFeeCents;
    const totalPrice = preShippingTotal + shippingSubtotal;
    const serviceFee = calcServiceFee(preShippingTotal, getCheckoutModel());

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
        // Persisted model drives all later branching — see the
        // checkoutModel note above createPrintOrder.
        checkoutModel: getCheckoutModel(),
      })
      .returning();

    revalidatePath("/dashboard/orders");
    return { orderId: order.id, cartId: cart.cartId };
  } catch (error) {
    logError("createPrintOrder", error);
    if (error instanceof CraftCloudApiError) {
      if (error.isQuoteExpired()) {
        return {
          error:
            "This quote has expired. Please pick a material again — prices may have changed.",
        };
      }
      // Never return the raw CraftCloudApiError message — it contains
      // internal API paths and upstream response bodies (CON-138).
      return { error: "Our print partner returned an error. Please try again." };
    }
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

    // Shipping is per-order on CraftCloud's side, but cart_items
    // redundantly stores the price on every row. Dedupe by shippingId
    // so a 2-item cart with one shipping option doesn't get charged
    // twice. The sum is stored on printOrders.shippingSubtotal so
    // downstream reads (Stripe line items, checkout page) can use
    // the canonical total instead of re-summing item rows.
    const totalMaterial = items.reduce(
      (sum, i) => sum + i.materialPrice * i.quantity,
      0
    );
    const totalShipping = dedupeShippingByShipId(items);
    // See createPrintOrder — service fee is 3% of the pre-shipping
    // subtotal so freight doesn't inflate our cut.
    const preShippingTotal = totalMaterial + productionFeeCents;
    const totalPrice = preShippingTotal + totalShipping;
    const serviceFee = calcServiceFee(preShippingTotal, getCheckoutModel());

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
        shippingSubtotal: totalShipping,
        vendor: vendorId,
        vendorName: resolvedVendorName,
        status: "cart_created",
        // Persisted model drives all later branching — see the
        // checkoutModel note above createPrintOrder.
        checkoutModel: getCheckoutModel(),
      })
      .returning();

    // Per-item shippingSubtotal stored as 0 — the canonical total
    // lives on printOrders.shippingSubtotal above. This stops the
    // doubling bug where summing item.shippingSubtotal across
    // multiple cart_items (which all carried the same shipping fee)
    // inflated the order total.
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
        shippingSubtotal: 0,
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
    if (error instanceof CraftCloudApiError) {
      if (error.isQuoteExpired()) {
        return {
          error:
            "One or more quotes in this cart have expired. Remove those items and re-add them from the quote page.",
        };
      }
      // Never return the raw CraftCloudApiError message — it contains
      // internal API paths and upstream response bodies (CON-138).
      return { error: "Our print partner returned an error. Please try again." };
    }
    return { error: "Failed to checkout vendor group. Please try again." };
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
  orderTotalPrice: number,
  /**
   * Canonical shipping total from printOrders.shippingSubtotal. We
   * prefer this over summing per-item rows because the per-item
   * shippingSubtotal was historically redundant (same shipping fee
   * copied onto every item row in a vendor group) — summing would
   * double-charge. New rows write the deduped total here and
   * zero on items.
   */
  orderShippingSubtotal: number | null
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
  }

  // Legacy rows (written before the shipping-dedupe fix) have
  // shippingSubtotal=null on the order row and duplicated prices on
  // items. Fall back to summing items but dedupe any exact
  // duplicates — a coarse best-effort repair.
  const totalShipping =
    orderShippingSubtotal != null
      ? orderShippingSubtotal
      : dedupeShippingSum(items);

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

/**
 * Legacy repair: collapses identical per-item shipping values down
 * to a single charge. Used only when `printOrders.shippingSubtotal`
 * is null (rows written before the dedupe fix). Same-vendor groups
 * historically wrote the identical shipping price to every item
 * row — summing them caused the double-charge bug.
 */
function dedupeShippingSum(
  items: Array<{ shippingSubtotal: number }>
): number {
  if (items.length === 0) return 0;
  // If every item has the same shipping value, assume it's the
  // pre-dedupe duplication pattern and count it once.
  const unique = new Set(items.map((i) => i.shippingSubtotal));
  if (unique.size === 1) return items[0].shippingSubtotal;
  // Mixed values — sum them (conservative: we don't know how they
  // should group). Not something new rows will produce.
  return items.reduce((sum, i) => sum + i.shippingSubtotal, 0);
}

/**
 * Derive the redirect base URL from the live request rather than a
 * build-time env var. NEXT_PUBLIC_APP_URL bakes at build time and,
 * when unset in production, the fallback "http://localhost:3000"
 * got embedded into the Stripe session's success/cancel URLs — so
 * every customer post-payment landed on a dead localhost page.
 * Mirrors the pattern in app/(app)/dashboard/settings/tokens/page.tsx.
 */
async function deriveAppUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function createStripeSessionForOrder(
  order: typeof printOrders.$inferSelect,
  opts: { email: string; isAnonFlow: boolean }
): Promise<{ id: string; url: string } | { error: string }> {
  const appUrl = await deriveAppUrl();

  // Two-step model: our session only AUTHORIZES the 3% service fee
  // (capture_method: "manual" below). Print + shipping are paid to
  // CraftCloud directly via their hosted bridge session, so the only
  // line item here is the fee.
  const isTwoStep = order.checkoutModel === "two_step";

  const lineItems: StripeLineItem[] = [];

  if (isTwoStep) {
    // Fee-only — no print/shipping lines.
  } else if (!order.fileAssetId) {
    // Multi-item order — build line items from printOrderItems
    const itemLines = await buildMultiItemLineItems(
      order.id,
      order.totalPrice,
      order.shippingSubtotal
    );
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
        description: isTwoStep
          ? "Materialize platform fee (3%) — authorized now, charged only when your order is placed"
          : "Materialize platform fee (3%)",
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
      // Two-step: hold the fee, don't charge it. The reconciliation
      // cron captures once CraftCloud payment is confirmed. NOTE:
      // under manual capture the completed session reports
      // payment_status "unpaid" — the webhook router special-cases
      // this via metadata.checkoutModel below.
      ...(isTwoStep ? { capture_method: "manual" as const } : {}),
      metadata: { printOrderId: order.id },
    },
    metadata: {
      printOrderId: order.id,
      type: "print_order",
      // Stamped on both models so the webhook (and anyone reading
      // Stripe events) can tell which lifecycle the session belongs
      // to without a DB lookup.
      checkoutModel: isTwoStep ? "two_step" : "single",
    },
    success_url: isTwoStep
      ? // Fee authorized — next stop is CraftCloud's hosted production
        // payment, surfaced on the pay-production page.
        `${appUrl}/orders/${order.id}/pay-production?fee=authorized`
      : `${appUrl}/dashboard/orders?${opts.isAnonFlow ? "welcome=1&" : ""}payment=success&orderId=${order.id}`,
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

    const stripe = getStripe();

    // Multi-tab/device guard: if a session was already minted for this
    // order (by a sibling tab firing slightly earlier), reuse it
    // instead of creating a second Stripe session for the same order.
    // Without this guard the user can end up with two open sessions
    // and pay twice. Skip when the value is a sentinel from an
    // in-flight claim — the claim re-fetch below handles that.
    if (
      order.stripeSessionId &&
      !isSessionClaimSentinel(order.stripeSessionId)
    ) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          order.stripeSessionId
        );
        if (existing.status === "open" && existing.url) {
          return { checkoutUrl: existing.url };
        }
        // Session completed (paid) but the webhook hasn't processed
        // yet — the row is still cart_created. Minting a second session
        // here would let the user pay twice. Surface a friendly message
        // and let the webhook advance the order. Do NOT null out the id.
        if (existing.status === "complete") {
          return {
            error:
              "This order is already being processed — check your orders in a moment.",
          };
        }
        // Expired/closed → fall through to mint a fresh one. We
        // can't atomically claim with isNull(stripeSessionId) so
        // null it out first via a conditional swap on the stale id.
        await db
          .update(printOrders)
          .set({ stripeSessionId: null })
          .where(
            and(
              eq(printOrders.id, params.orderId),
              eq(printOrders.stripeSessionId, order.stripeSessionId)
            )
          );
      } catch (err) {
        logError("completePrintOrder.retrieve", err);
      }
    }

    // Atomic claim: only one tab/device can mint a new session.
    // The conditional WHERE makes this race-safe across replicas.
    const sentinel = `${SESSION_CLAIM_PREFIX}${nanoid()}`;
    const claimed = await db
      .update(printOrders)
      .set({ stripeSessionId: sentinel })
      .where(
        and(
          eq(printOrders.id, params.orderId),
          eq(printOrders.userId, userId),
          eq(printOrders.status, "cart_created"),
          isNull(printOrders.stripeSessionId)
        )
      )
      .returning({ id: printOrders.id });

    if (claimed.length === 0) {
      // Sibling worker beat us. Re-fetch and try to hand back what
      // they wrote. If they're still mid-flight (sentinel value),
      // surface a friendly retry message — by the time the user
      // refreshes, the real id will be live.
      const [refreshed] = await db
        .select()
        .from(printOrders)
        .where(eq(printOrders.id, params.orderId));
      if (!refreshed) return { error: "Order not found" };
      if (refreshed.status !== "cart_created") {
        return { error: "Order already processed" };
      }
      if (
        refreshed.stripeSessionId &&
        !isSessionClaimSentinel(refreshed.stripeSessionId)
      ) {
        try {
          const existing = await stripe.checkout.sessions.retrieve(
            refreshed.stripeSessionId
          );
          if (existing.status === "open" && existing.url) {
            return { checkoutUrl: existing.url };
          }
        } catch (err) {
          logError("completePrintOrder.retrieve.lostRace", err);
        }
      }
      return {
        error: "Checkout already in progress. Please refresh and try again.",
      };
    }

    // Two-step model: the CraftCloud order is placed UP-FRONT, unpaid,
    // and CraftCloud's hosted bridge session is minted BEFORE our
    // fee-only Stripe session. Both steps are individually idempotent
    // (conditional writes + reuse), so a retry after a partial failure
    // picks up where the last attempt left off.
    if (order.checkoutModel === "two_step") {
      const prep = await prepareTwoStepOrder(order, {
        email: params.email,
        shipping: params.shipping,
        billing: params.billing,
      });
      if ("error" in prep) {
        await releaseSessionClaim(params.orderId, sentinel);
        return { error: prep.error };
      }
    }

    let sessionResult: Awaited<ReturnType<typeof createStripeSessionForOrder>>;
    try {
      sessionResult = await createStripeSessionForOrder(order, {
        email: params.email,
        isAnonFlow: params.isAnonFlow ?? false,
      });
    } catch (err) {
      await releaseSessionClaim(params.orderId, sentinel);
      throw err;
    }
    if ("error" in sessionResult) {
      await releaseSessionClaim(params.orderId, sentinel);
      return { error: sessionResult.error };
    }

    // Conditional swap: only commit our session if our sentinel is
    // still in place. If somehow another actor moved past us, leave
    // their state alone.
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
      .where(
        and(
          eq(printOrders.id, params.orderId),
          eq(printOrders.stripeSessionId, sentinel)
        )
      );

    revalidatePath("/dashboard/orders");
    return { checkoutUrl: sessionResult.url };
  } catch (error) {
    logError("completePrintOrder", error);
    return { error: "Failed to create checkout. Please try again." };
  }
}

const SESSION_CLAIM_PREFIX = "session_claim:";

function isSessionClaimSentinel(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(SESSION_CLAIM_PREFIX);
}

async function releaseSessionClaim(orderId: string, sentinel: string) {
  try {
    await db
      .update(printOrders)
      .set({ stripeSessionId: null })
      .where(
        and(
          eq(printOrders.id, orderId),
          eq(printOrders.stripeSessionId, sentinel)
        )
      );
  } catch (err) {
    logError("completePrintOrder.releaseSessionClaim", err);
  }
}

/**
 * Two-step checkout prep — runs under the session-claim sentinel in
 * completePrintOrder, BEFORE the fee-only Stripe session is minted:
 *
 *   1. Place the CraftCloud order up-front, unpaid. Under two_step
 *      the customer pays CraftCloud directly, so placement isn't
 *      gated on our webhook the way single-checkout is.
 *   2. Create CraftCloud's hosted Stripe bridge session the customer
 *      will pay production + shipping at.
 *
 * Each step persists via a conditional UPDATE gated on the column
 * still being NULL. If 0 rows come back, another actor already
 * persisted a value — we re-fetch and REUSE theirs rather than error
 * (or worse, double-place). A retry after a partial failure (e.g.
 * order placed, bridge session creation died) therefore skips the
 * steps that already committed.
 */
async function prepareTwoStepOrder(
  order: typeof printOrders.$inferSelect,
  contact: {
    email: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  }
): Promise<
  { craftCloudOrderId: string; bridgeSessionUrl: string } | { error: string }
> {
  // `order` was read before the session claim — a previous claim
  // holder may have placed the CraftCloud order and released before
  // we won. Re-read so we never place a second order off a stale
  // snapshot.
  const [fresh] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, order.id));
  let craftCloudOrderId = fresh?.craftCloudOrderId ?? order.craftCloudOrderId;
  let bridgeSessionUrl = fresh?.bridgeSessionUrl ?? order.bridgeSessionUrl;

  if (!craftCloudOrderId) {
    let ccOrderId: string;
    try {
      const ccOrder = await createOrder({
        cartId: order.craftCloudCartId!,
        user: {
          emailAddress: contact.email,
          shipping: contact.shipping,
          billing: contact.billing,
        },
      });
      ccOrderId = ccOrder.orderId;
    } catch (err) {
      logError("completePrintOrder.twoStep.createOrder", err);
      return {
        error:
          "Could not place your order with the print service. Please try again.",
      };
    }

    const wrote = await db
      .update(printOrders)
      .set({ craftCloudOrderId: ccOrderId })
      .where(
        and(
          eq(printOrders.id, order.id),
          isNull(printOrders.craftCloudOrderId)
        )
      )
      .returning({ id: printOrders.id });

    if (wrote.length > 0) {
      craftCloudOrderId = ccOrderId;
    } else {
      // Another tab/worker won the persist — reuse their id. Do NOT
      // error: the user just needs one valid order, whichever actor
      // placed it.
      const [refetched] = await db
        .select()
        .from(printOrders)
        .where(eq(printOrders.id, order.id));
      craftCloudOrderId = refetched?.craftCloudOrderId ?? ccOrderId;
    }
  }

  if (!bridgeSessionUrl) {
    // Same header-derived base as createStripeSessionForOrder — never
    // NEXT_PUBLIC_APP_URL for runtime URL construction.
    const appUrl = await deriveAppUrl();
    let bridge: { sessionId: string; sessionUrl: string };
    try {
      bridge = await createStripeCheckout({
        orderId: craftCloudOrderId,
        returnUrl: `${appUrl}/dashboard/orders?production=paid&orderId=${order.id}`,
        cancelUrl: `${appUrl}/orders/${order.id}/pay-production`,
        isTestOrder: isSandboxMode(),
      });
    } catch (err) {
      logError("completePrintOrder.twoStep.createStripeCheckout", err);
      return {
        error:
          "Could not set up the production payment. Please try again.",
      };
    }

    const wrote = await db
      .update(printOrders)
      .set({
        bridgeSessionId: bridge.sessionId,
        bridgeSessionUrl: bridge.sessionUrl,
      })
      .where(
        and(eq(printOrders.id, order.id), isNull(printOrders.bridgeSessionUrl))
      )
      .returning({ id: printOrders.id });

    if (wrote.length > 0) {
      bridgeSessionUrl = bridge.sessionUrl;
    } else {
      // Same reuse pattern as the order id above.
      const [refetched] = await db
        .select()
        .from(printOrders)
        .where(eq(printOrders.id, order.id));
      bridgeSessionUrl = refetched?.bridgeSessionUrl ?? bridge.sessionUrl;
    }
  }

  return { craftCloudOrderId, bridgeSessionUrl };
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

    // Two-step orders parked at awaiting_production_payment have an
    // authorized-but-uncaptured fee hold and an unpaid CraftCloud
    // bridge session. Resume there means: verify the hold is still
    // live, then send the user back to CraftCloud's hosted payment.
    // (cart_created two-step rows fall through to the normal path
    // below, which mints fee-only sessions for them automatically via
    // createStripeSessionForOrder's checkoutModel branch.)
    if (
      order.checkoutModel === "two_step" &&
      order.status === "awaiting_production_payment"
    ) {
      return resumeTwoStepProductionPayment(order);
    }

    if (order.status !== "cart_created") {
      return { error: "Order already processed" };
    }
    if (!order.shippingAddress?.email) {
      // Never made it past the address step — can't rebuild a
      // session without an email. Caller should fall back to the
      // material-picker entry point.
      return { error: "Order has no saved address" };
    }

    // CON-159: Auto-approved orders store the off-session PaymentIntent
    // id (pi_…) in stripeSessionId. The PI is NOT a Checkout session —
    // sessions.retrieve("pi_…") would throw. These rows are awaiting
    // CraftCloud placement by the place-auto-approved-orders cron; the
    // Resume button cannot do anything useful. Suppress it with a
    // friendly message instead of letting sessions.retrieve throw.
    if (
      order.stripeSessionId &&
      order.stripeSessionId.startsWith("pi_") &&
      !order.craftCloudOrderId
    ) {
      return {
        error:
          "Your order is being placed — it will appear under Orders shortly.",
      };
    }

    const stripe = getStripe();

    // Same multi-tab guard as completePrintOrder: if a real session
    // is already attached, retrieve it; if it's open, return that URL
    // so two Resume clicks across tabs land on the same Stripe page.
    // Skip claim sentinels — they signal a sibling worker is mid-flight
    // and the lost-race branch below handles the wait.
    if (
      order.stripeSessionId &&
      !isSessionClaimSentinel(order.stripeSessionId)
    ) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          order.stripeSessionId
        );
        if (existing.status === "open" && existing.url) {
          return { checkoutUrl: existing.url };
        }
        // Session completed (paid) but the webhook hasn't processed
        // yet — the row is still cart_created. Minting a second session
        // here would let the user pay twice. Surface a friendly message
        // and let the webhook advance the order. Do NOT null out the id.
        if (existing.status === "complete") {
          return {
            error:
              "This order is already being processed — check your orders in a moment.",
          };
        }
        // Expired/closed → null out the stale id so the atomic
        // claim below can fire on a clean row.
        await db
          .update(printOrders)
          .set({ stripeSessionId: null })
          .where(
            and(
              eq(printOrders.id, orderId),
              eq(printOrders.stripeSessionId, order.stripeSessionId)
            )
          );
      } catch (error) {
        logError("resumePrintOrder.retrieve", error);
      }
    }

    // Atomic claim — only one Resume click across tabs/devices wins.
    const sentinel = `${SESSION_CLAIM_PREFIX}${nanoid()}`;
    const claimed = await db
      .update(printOrders)
      .set({ stripeSessionId: sentinel })
      .where(
        and(
          eq(printOrders.id, orderId),
          eq(printOrders.userId, userId),
          eq(printOrders.status, "cart_created"),
          isNull(printOrders.stripeSessionId)
        )
      )
      .returning({ id: printOrders.id });

    if (claimed.length === 0) {
      const [refreshed] = await db
        .select()
        .from(printOrders)
        .where(eq(printOrders.id, orderId));
      if (!refreshed) return { error: "Order not found" };
      if (refreshed.status !== "cart_created") {
        return { error: "Order already processed" };
      }
      if (
        refreshed.stripeSessionId &&
        !isSessionClaimSentinel(refreshed.stripeSessionId)
      ) {
        try {
          const existing = await stripe.checkout.sessions.retrieve(
            refreshed.stripeSessionId
          );
          if (existing.status === "open" && existing.url) {
            return { checkoutUrl: existing.url };
          }
        } catch (err) {
          logError("resumePrintOrder.retrieve.lostRace", err);
        }
      }
      return {
        error: "Checkout already in progress. Please refresh and try again.",
      };
    }

    let sessionResult: Awaited<ReturnType<typeof createStripeSessionForOrder>>;
    try {
      sessionResult = await createStripeSessionForOrder(order, {
        email: order.shippingAddress.email,
        isAnonFlow: false,
      });
    } catch (err) {
      await releaseSessionClaim(orderId, sentinel);
      throw err;
    }
    if ("error" in sessionResult) {
      await releaseSessionClaim(orderId, sentinel);
      return { error: sessionResult.error };
    }

    // Conditional swap — only commit if our sentinel is still here.
    await db
      .update(printOrders)
      .set({ stripeSessionId: sessionResult.id })
      .where(
        and(
          eq(printOrders.id, orderId),
          eq(printOrders.stripeSessionId, sentinel)
        )
      );

    return { checkoutUrl: sessionResult.url };
  } catch (error) {
    logError("resumePrintOrder", error);
    return { error: "Failed to resume order. Please try again." };
  }
}

const FEE_AUTH_EXPIRED_ERROR =
  "Your card authorization expired. Please start a new checkout from the material picker.";

/**
 * Resume path for two-step orders sitting in
 * awaiting_production_payment: the 3% fee was authorized (manual
 * capture — a hold, not a charge) and the CraftCloud order is placed
 * but unpaid. Whether we can send the user back to CraftCloud's
 * bridge session depends on the fee hold still being capturable —
 * resuming production payment after the hold lapsed would leave the
 * reconciliation cron with nothing to capture.
 */
async function resumeTwoStepProductionPayment(
  order: typeof printOrders.$inferSelect
): Promise<{ checkoutUrl: string } | { error: string }> {
  // Defensive: rows in this status should always carry both values
  // (the webhook stamps the PI id, completePrintOrder the bridge
  // URL). If either is missing we can't safely resume — treat it
  // like an expired hold and route through a fresh checkout.
  if (!order.feePaymentIntentId || !order.bridgeSessionUrl) {
    return { error: FEE_AUTH_EXPIRED_ERROR };
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(
    order.feePaymentIntentId
  );

  if (intent.status === "requires_capture") {
    // Fee hold is still good — the only missing piece is CraftCloud's
    // production payment. Send them straight back to it.
    return { checkoutUrl: order.bridgeSessionUrl };
  }
  if (intent.status === "canceled") {
    // Manual-capture authorizations expire (Stripe cancels them after
    // ~7 days) — the fee can no longer be captured, so the whole
    // two-step chain has to restart.
    return { error: FEE_AUTH_EXPIRED_ERROR };
  }
  // Anything else (succeeded = the cron already captured, processing,
  // …) means this order is past self-service resumption.
  return { error: "Order already processed" };
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

    // Two-step orders: the customer paid CraftCloud directly for
    // production + shipping; our session only captured the 3% fee.
    // Refunding the fee alone would leave the customer believing they
    // got a full refund while CraftCloud may still produce and ship the
    // print. Until a CraftCloud cancellation API exists (CON-109) we
    // cannot safely complete a two-step refund self-service — route to
    // support instead. Do NOT flip the status to `refunded`.
    if (order.checkoutModel === "two_step") {
      return {
        error:
          "This order was processed through a two-step checkout. To request a refund, please contact support — we'll coordinate with the print vendor on your behalf.",
      };
    }

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

    // Issue full refund. The deterministic idempotency key (one refund
    // per order) means a double-click or retry returns the existing
    // refund instead of issuing a second one — there's no atomic status
    // claim before this call, so the key is the dedup primitive.
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
      },
      { idempotencyKey: `print-refund:${order.id}` }
    );

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
