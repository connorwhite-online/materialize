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
import { printOrders, printOrderItems, cartItems, fileAssets, files, users } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { deriveAppUrl } from "@/lib/utils/request-url";
import {
  createCart,
  createOrder,
  createStripeCheckout,
  getOrderStatus,
  getPrice,
  isMockCheckoutMode,
  CraftCloudApiError,
} from "@/lib/craftcloud/client";
import { getCheckoutModel, isSandboxMode } from "@/lib/env";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { getStripe } from "@/lib/stripe";
import { printOrderSchema } from "@/lib/validations/print";
import { checkoutAddressSchema } from "@/lib/validations/address";
import { logError } from "@/lib/logger";
import { userCanPrintAsset } from "@/lib/entitlement";
import { promoteStudioDraftsForAssets } from "@/lib/studio-drafts";
import { dedupeShippingByShipId } from "@/lib/pricing/shipping";
import type { Address, Currency } from "@/lib/craftcloud/types";
import { calcServiceFee } from "@/lib/fees";
import { getOrCreateStripeCustomer } from "@/lib/stripe/customers";
import { persistSavedFeeCard } from "@/lib/stripe/handle-print-order-payment";
import { mintPayProductionToken } from "@/lib/orders/pay-production-token";

const QUOTE_EXPIRED_ERROR =
  "This quote has expired. Please pick a material again — prices may have changed.";

/**
 * What completePrintOrder hands back:
 *
 *  - `checkoutUrl` — redirect the browser (hosted Stripe Checkout, or
 *    straight to CraftCloud's payment page when the one-tap saved-card
 *    authorization succeeded).
 *  - `feeSheet` — render the in-page embedded fee sheet (two_step
 *    first-timers): a manual-capture PaymentIntent is waiting to be
 *    confirmed client-side via the Payment Element, after which the
 *    client calls finalizeFeeAuthorization.
 *  - `savedCardConfirm` — the user has a saved payment method and
 *    hasn't yet said which way to pay: show the confirmation sheet
 *    and call back with `feePayment` set. Returned BEFORE any
 *    CraftCloud or Stripe work happens — a saved card must never be
 *    charged without the user explicitly confirming it this session.
 */
export type CompletePrintOrderResult =
  | { checkoutUrl: string }
  | {
      feeSheet: {
        clientSecret: string;
        orderId: string;
        amountCents: number;
        /** Buyer email, used to prefill Link in the Payment Element. */
        email?: string;
      };
    }
  | {
      savedCardConfirm: {
        orderId: string;
        amountCents: number;
        /** Card brand ("visa", "mastercard", …) or PM type ("link"). */
        brand: string;
        /** Last four digits; null for non-card methods (Link). */
        last4: string | null;
      };
    }
  | { error: string };

// Rounding-only tolerance: getPrice() returns dollars as a float;
// converting to cents can introduce a fractional-cent difference
// between what the client displayed and what we re-derive here.
// Anything beyond this is treated as a tampered or stale price, never
// a legitimate business discount (MTR-130).
const PRICE_RECONCILE_TOLERANCE_CENTS = 1;

/**
 * Re-derive the authoritative per-unit material price for a quote
 * from CraftCloud (via the priceId the client already polled to
 * stability) instead of trusting the client-supplied materialPrice.
 * Money-critical — do not weaken the tolerance without a documented
 * policy decision (see MTR-130's STOP condition on divergence
 * tolerance).
 *
 * Returns an error when:
 *   - priceId is unknown/expired to CraftCloud, or
 *   - quoteId can't be found in that price response (consumed/stale), or
 *   - the claimed price diverges from the authoritative one beyond a
 *     rounding tolerance, or
 *   - `expectedQuantity` is given and diverges from the quote's own
 *     baked-in quantity (MONEY-1).
 */
async function reconcileMaterialPrice(params: {
  priceId: string;
  quoteId: string;
  claimedPriceCents: number;
  /**
   * When provided, also verify the CraftCloud quote's own baked-in
   * quantity matches the quantity we're about to bill. A cart line's
   * `quoteId` and `quantity` columns can drift apart if a quantity
   * change's re-quote fails partway (see cart-context.tsx
   * updateQuantity) — the quoteId still encodes the OLD quantity
   * while cartItems.quantity holds the NEW one. checkoutVendorGroup
   * bills `quantity * price` but CraftCloud produces whatever the
   * quoteId itself bakes in, so a mismatch here must hard-block
   * checkout rather than silently overcharge or undercharge
   * (MONEY-1). Only checkoutVendorGroup passes this — createPrintOrder
   * mints its quote and quantity together in one call and can't drift.
   */
  expectedQuantity?: number;
}): Promise<{ ok: true; priceCents: number } | { ok: false; error: string }> {
  let snapshot;
  try {
    snapshot = await getPrice(params.priceId);
  } catch (error) {
    if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
      return { ok: false, error: QUOTE_EXPIRED_ERROR };
    }
    throw error;
  }

  const quote = snapshot.quotes?.find((q) => q.quoteId === params.quoteId);
  if (!quote) {
    return { ok: false, error: QUOTE_EXPIRED_ERROR };
  }

  if (
    params.expectedQuantity !== undefined &&
    quote.quantity !== params.expectedQuantity
  ) {
    return {
      ok: false,
      error:
        "This item's quantity is out of sync with its saved price. Please refresh and try again.",
    };
  }

  const authoritativeCents = Math.round(quote.price * 100);
  if (
    Math.abs(authoritativeCents - params.claimedPriceCents) >
    PRICE_RECONCILE_TOLERANCE_CENTS
  ) {
    return {
      ok: false,
      error:
        "Pricing has changed since you selected this option. Please refresh and try again.",
    };
  }

  return { ok: true, priceCents: authoritativeCents };
}

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
  priceId: string;
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

    // Re-derive the authoritative per-unit price from CraftCloud
    // instead of trusting the client-supplied materialPrice — a
    // tampered request must not flow into the charge (MTR-130).
    const claimedMaterialSubtotal = Math.round(data.materialPrice * 100);
    const reconciled = await reconcileMaterialPrice({
      priceId: data.priceId,
      quoteId: data.quoteId,
      claimedPriceCents: claimedMaterialSubtotal,
    });
    if (!reconciled.ok) return { error: reconciled.error };

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

    const materialSubtotal = reconciled.priceCents;
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

    // An order is a save (docs/text-to-cad/05 §B): if this asset backs an
    // unsaved text-to-CAD draft, promote it to a real library entry
    // (visibility unchanged). Best-effort — never fails the order.
    await promoteStudioDraftsForAssets({
      userId,
      fileAssetIds: [data.fileAssetId],
    });

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
 * row, and one printOrderItems row per cart item. The caller should
 * then run completePrintOrder to create the Stripe session.
 *
 * MONEY-2: the source `cartItems` rows are intentionally left in
 * place here — this runs before any Stripe session exists and before
 * `shippingAddress` is persisted, so a user who abandons the tab
 * between this call and completePrintOrder would otherwise lose the
 * entire cart with no recovery path until the 48h stale-order cron
 * cancels the order. Clearing the cart is deferred to the Stripe
 * webhook's successful-placement branch
 * (`clearCartItemsForOrder` in lib/stripe/handle-print-order-payment.ts),
 * so the cart only disappears once payment actually places the order.
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

    // Re-derive each item's authoritative per-unit price from
    // CraftCloud (via the priceId captured when it was added to cart)
    // instead of trusting the stored cartItems.materialPrice at
    // checkout time — a tampered add-to-cart write, or a price that
    // simply went stale between add and checkout, must not silently
    // flow into the Stripe charge (MTR-130). Legacy rows written
    // before the priceId column existed have no way to reconcile —
    // skip them (best-effort) rather than blocking checkout on an
    // existing cart.
    const reconciledMaterialCentsById = new Map<string, number>();
    for (const item of items) {
      if (!item.priceId) continue;
      const reconciled = await reconcileMaterialPrice({
        priceId: item.priceId,
        quoteId: item.quoteId,
        claimedPriceCents: item.materialPrice,
        expectedQuantity: item.quantity,
      });
      if (!reconciled.ok) return { error: reconciled.error };
      reconciledMaterialCentsById.set(item.id, reconciled.priceCents);
    }
    const materialCentsFor = (item: (typeof items)[number]) =>
      reconciledMaterialCentsById.get(item.id) ?? item.materialPrice;

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
      (sum, i) => sum + materialCentsFor(i) * i.quantity,
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
        materialSubtotal: materialCentsFor(i),
        shippingSubtotal: 0,
      }))
    );

    // MONEY-2: cartItems are deliberately NOT deleted here — see the
    // docstring above checkoutVendorGroup. They're cleared once the
    // Stripe webhook confirms the order actually placed.

    // An order is a save (docs/text-to-cad/05 §B) — promote any unsaved
    // text-to-CAD drafts among the ordered assets. Best-effort.
    await promoteStudioDraftsForAssets({
      userId,
      fileAssetIds: items.map((i) => i.fileAssetId),
    });

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

  // Two-step: attach the user's Stripe Customer and save the card
  // during this first fee payment (setup_future_usage). Returning
  // buyers then get a one-tap fee authorization in completePrintOrder
  // instead of a Checkout redirect. Same customer agent billing
  // charges — a card split across two Stripe customers would be
  // unusable off-session. Best-effort: if customer resolution fails
  // we fall back to a plain email session (checkout still works, the
  // card just isn't saved).
  let customerId: string | null = null;
  if (isTwoStep) {
    try {
      customerId = await getOrCreateStripeCustomer(order.userId, {
        email: opts.email,
      });
    } catch (err) {
      logError("createStripeSessionForOrder.customer", err);
    }
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(customerId ? { customer: customerId } : { customer_email: opts.email }),
    line_items: lineItems,
    payment_intent_data: {
      // Two-step: hold the fee, don't charge it. The reconciliation
      // cron captures once CraftCloud payment is confirmed. NOTE:
      // under manual capture the completed session reports
      // payment_status "unpaid" — the webhook router special-cases
      // this via metadata.checkoutModel below.
      ...(isTwoStep ? { capture_method: "manual" as const } : {}),
      // Save the card for future one-tap fee authorizations. Checkout
      // renders the required consent language when this is set.
      ...(customerId ? { setup_future_usage: "off_session" as const } : {}),
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
        // payment, surfaced on the pay-production page. The signed
        // token lets that page render WITHOUT a Clerk session: Stripe's
        // redirect can land in a cookie-isolated context (iOS PWA
        // in-app browser) where the user is effectively signed out.
        `${appUrl}/orders/${order.id}/pay-production?fee=authorized&t=${mintPayProductionToken(order.id)}`
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
  /**
   * How the two_step service fee should be paid. Omitted on the
   * first call — when a saved payment method exists the action
   * answers with `savedCardConfirm` instead of charging, and the
   * client calls again with the user's explicit choice:
   * "saved_card" runs the one-tap authorization, "new_card" goes
   * straight to the embedded Payment Element sheet.
   */
  feePayment?: "saved_card" | "new_card";
}): Promise<CompletePrintOrderResult> {
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
    // in-flight claim — the claim re-fetch below handles that. A
    // `pi_…` value means this order was auto-approved and charged
    // off-session by an agent — there's no Checkout session to
    // resume, so bail with a friendly message instead of letting
    // sessions.retrieve throw (MTR-233).
    const existingRefKind = classifyPaymentRef(order.stripeSessionId);
    if (existingRefKind === "payment_intent") {
      // Could be an abandoned embedded fee sheet (reopen it) or an
      // agent off-session charge (keep the existing message) —
      // resolveEmbeddedFeePI tells them apart via PI metadata.
      const resolved = await resolveEmbeddedFeePI(order);
      if (resolved.kind === "sheet") {
        return {
          feeSheet: {
            clientSecret: resolved.clientSecret,
            orderId: order.id,
            amountCents: order.serviceFee,
            email: order.shippingAddress?.email,
          },
        };
      }
      if (resolved.kind === "authorized") {
        revalidatePath("/dashboard/orders");
        return { checkoutUrl: resolved.productionPaymentUrl };
      }
      if (resolved.kind === "error") {
        return { error: resolved.message };
      }
      if (resolved.kind === "not_sheet") {
        return { error: AGENT_CHARGED_ORDER_ERROR };
      }
      // "cleared" — dead PI ref nulled; fall through to the normal
      // claim flow, which mints a fresh checkout.
    }
    if (existingRefKind === "session") {
      const existingSessionId = order.stripeSessionId!;
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          existingSessionId
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
              eq(printOrders.stripeSessionId, existingSessionId)
            )
          );
      } catch (err) {
        logError("completePrintOrder.retrieve", err);
      }
    }

    // Two-step + saved payment method + no explicit choice yet →
    // stop for confirmation BEFORE claiming, placing the CraftCloud
    // order, or touching Stripe. The one-tap path only ever runs
    // after the user answers this sheet, so a saved card can never
    // be charged silently.
    if (order.checkoutModel === "two_step" && !params.feePayment) {
      const savedCard = await getSavedFeeCardSummary(order.userId);
      if (savedCard) {
        return {
          savedCardConfirm: {
            orderId: order.id,
            amountCents: order.serviceFee,
            brand: savedCard.brand,
            last4: savedCard.last4,
          },
        };
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
      const refreshedRefKind = classifyPaymentRef(refreshed.stripeSessionId);
      if (refreshedRefKind === "payment_intent") {
        return { error: AGENT_CHARGED_ORDER_ERROR };
      }
      if (refreshedRefKind === "session") {
        try {
          const existing = await stripe.checkout.sessions.retrieve(
            refreshed.stripeSessionId!
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

      // One-tap fee authorization — ONLY after the user explicitly
      // confirmed their saved card on the savedCardConfirm sheet
      // (feePayment: "saved_card"). Any failure (decline, 3DS
      // challenge, detached card) falls through to the embedded
      // sheet / hosted Checkout below; the session claim sentinel is
      // still held either way.
      const oneTap =
        params.feePayment === "saved_card"
          ? await tryAuthorizeFeeWithSavedCard(
              order,
              sentinel,
              {
                email: params.email,
                shipping: params.shipping,
                billing: params.billing,
              },
              prep.bridgeSessionUrl
            )
          : null;
      if (oneTap) {
        revalidatePath("/dashboard/orders");
        return { checkoutUrl: oneTap.redirectUrl };
      }

      // No saved card — try the in-page embedded fee sheet (Payment
      // Element) before falling back to hosted Checkout. Keeps the
      // buyer on our page for the fee so the only redirect in the
      // whole flow is CraftCloud's own payment page. Returns null on
      // any miss (no publishable key deployed, customer resolution or
      // PI creation failure, lost sentinel), and the hosted-session
      // path below takes over unchanged.
      const sheet = await prepareEmbeddedFeeSheet(order, sentinel, {
        email: params.email,
        shipping: params.shipping,
        billing: params.billing,
      });
      if (sheet) {
        revalidatePath("/dashboard/orders");
        return { feeSheet: sheet };
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

// Surfaced whenever we'd otherwise try to treat an off-session
// PaymentIntent id as a Checkout session — same copy resumePrintOrder
// has always shown for this case (MTR-233). Agent auto-approved orders
// store the PI id directly in stripeSessionId (lib/mcp/internal/
// orders.ts:353); there's no Checkout session to resume.
const AGENT_CHARGED_ORDER_ERROR =
  "Your order is being placed — it will appear under Orders shortly.";

type PaymentRefKind = "session" | "payment_intent" | "claim" | "none";

/**
 * printOrders.stripeSessionId is an overloaded column (AGENTS.md
 * "Implicit contracts"): a Stripe Checkout session id (`cs_…`), an
 * off-session PaymentIntent id (`pi_…`, agent auto-approved path), or
 * a `session_claim:<nanoid>` sentinel written while a claim is
 * in-flight. Every read of this column must classify it before
 * deciding what to do — in particular, `stripe.checkout.sessions.
 * retrieve()` must only ever be called on a `"session"` value; calling
 * it on a `pi_…` id throws (MTR-233).
 */
function classifyPaymentRef(value: string | null | undefined): PaymentRefKind {
  if (!value) return "none";
  if (value.startsWith(SESSION_CLAIM_PREFIX)) return "claim";
  if (value.startsWith("pi_")) return "payment_intent";
  return "session";
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
 * Authorize the two_step service fee against the user's saved card,
 * skipping the hosted Checkout redirect entirely.
 *
 * Customer-initiated (the buyer just clicked "Proceed to checkout"),
 * so `off_session: false`: Stripe may respond requires_action for
 * SCA cards, which we treat as "fall back to hosted Checkout" rather
 * than attempting an on-page 3DS flow. Manual capture, mirroring the
 * hosted fee session — the hold is captured by the reconcile cron
 * once CraftCloud confirms production payment, per the two_step
 * money invariant.
 *
 * On success this performs the SAME state advancement the webhook's
 * handleTwoStepFeeAuthorization does for hosted sessions (status →
 * awaiting_production_payment + feePaymentIntentId), because no
 * checkout.session.completed event will ever fire for this order.
 * The PI id also lands in stripeSessionId via the sentinel swap —
 * consistent with the agent auto-approve path, and classifyPaymentRef
 * already handles `pi_…` values there.
 *
 * Returns null on ANY failure so the caller falls through to the
 * hosted session. The claim sentinel is left in place for that path.
 */
async function tryAuthorizeFeeWithSavedCard(
  order: typeof printOrders.$inferSelect,
  sentinel: string,
  contact: {
    email: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  },
  bridgeSessionUrl: string
): Promise<{ redirectUrl: string } | null> {
  const [billingRow] = await db
    .select({
      stripeCustomerId: users.stripeCustomerId,
      defaultPaymentMethod: users.defaultPaymentMethod,
    })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1);

  if (!billingRow?.stripeCustomerId || !billingRow.defaultPaymentMethod) {
    return null;
  }

  const stripe = getStripe();
  let intent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: order.serviceFee,
        currency: "usd",
        customer: billingRow.stripeCustomerId,
        payment_method: billingRow.defaultPaymentMethod,
        confirm: true,
        off_session: false,
        capture_method: "manual",
        // No return_url + no redirect-based methods: a saved card
        // either authorizes synchronously or we fall back to hosted
        // Checkout, where redirects are Stripe's problem.
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: {
          printOrderId: order.id,
          type: "print_order",
          checkoutModel: "two_step",
          source: "saved_card_fee_auth",
        },
      },
      // Retries of completePrintOrder for the same order reuse the
      // same PI instead of stacking multiple holds on the card.
      { idempotencyKey: `fee-auth:${order.id}` }
    );
  } catch (err) {
    // Declined / requires 3DS / detached card — all legitimate
    // fall-back-to-Checkout cases, but log so a systemic failure
    // (e.g. every saved card suddenly declining) is visible.
    logError("completePrintOrder.savedCardFeeAuth", err);
    return null;
  }

  // Manual-capture success is requires_capture — the hold exists.
  // Anything else (requires_action, processing, …) → hosted fallback.
  if (intent.status !== "requires_capture") {
    return null;
  }

  // Same advancement the webhook performs for hosted fee sessions.
  // Conditional on cart_created so a duplicate call can't regress
  // an order that already moved on.
  const advanced = await db
    .update(printOrders)
    .set({
      status: "awaiting_production_payment",
      feePaymentIntentId: intent.id,
      feeAuthorizedAt: new Date(),
      stripeSessionId: intent.id,
      shippingAddress: {
        email: contact.email,
        shipping: contact.shipping,
        billing: contact.billing,
      },
    })
    .where(
      and(
        eq(printOrders.id, order.id),
        eq(printOrders.status, "cart_created"),
        eq(printOrders.stripeSessionId, sentinel)
      )
    )
    .returning({ id: printOrders.id });

  if (advanced.length === 0) {
    // Lost the sentinel or the status moved — cancel our hold so it
    // can't sit uncaptured on the card, and let the caller fall back.
    try {
      await stripe.paymentIntents.cancel(intent.id);
    } catch (err) {
      logError("completePrintOrder.savedCardFeeAuth.cancel", err);
    }
    return null;
  }

  return { redirectUrl: bridgeSessionUrl };
}

/**
 * Describe the user's saved payment method for the pre-checkout
 * confirmation sheet. Null when nothing is saved, or when Stripe
 * can't describe it (detached card, API error) — the caller then
 * skips one-tap entirely and offers the Payment Element sheet, so a
 * lookup failure can never turn into a silent charge.
 */
async function getSavedFeeCardSummary(
  userId: string
): Promise<{ brand: string; last4: string | null } | null> {
  const [row] = await db
    .select({
      stripeCustomerId: users.stripeCustomerId,
      defaultPaymentMethod: users.defaultPaymentMethod,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.stripeCustomerId || !row.defaultPaymentMethod) return null;

  try {
    const pm = await getStripe().paymentMethods.retrieve(
      row.defaultPaymentMethod
    );
    if (pm.card) return { brand: pm.card.brand, last4: pm.card.last4 };
    // Link (and any future non-card method) has no last4 — the sheet
    // renders the method name alone.
    return { brand: pm.type, last4: null };
  } catch (err) {
    logError("completePrintOrder.savedCardSummary", err);
    return null;
  }
}

const EMBEDDED_FEE_SHEET_SOURCE = "embedded_fee_sheet";

// The only methods the embedded sheet offers. Anything redirect-based
// (PayPal, banks) belongs on hosted Checkout. Also the pin list
// resolveEmbeddedFeePI enforces on reused PIs.
//
// "link" is required for the Link button in the sheet's Express
// Checkout Element (one-tap row alongside Apple Pay / Google Pay,
// which ride on "card"). The Payment Element itself renders card-only
// — its wallets option suppresses link/applePay/googlePay so the
// accordion stays a clean card form (see fee-payment-sheet.tsx).
//
// ⚠️ Merchant-level prerequisite: "Instant Bank Payments" must stay
// OFF in the Stripe Dashboard's Link settings. With it on, link in
// this list resurrects a "Bank" accordion row (Financial Connections
// institution picker — test tiles in sandbox, real banks in live),
// which is exactly the slow, form-heavy UI this sheet exists to
// avoid, and there is no API or Payment Element option to suppress it
// per-request.
const SHEET_PAYMENT_METHOD_TYPES = ["card", "link"];

/**
 * Set up the in-page embedded fee sheet: a manual-capture
 * PaymentIntent the client confirms with the Payment Element, so
 * first-time two_step buyers never leave our page for the fee — the
 * only redirect left in the flow is CraftCloud's own payment page.
 *
 * Runs under the session-claim sentinel, after prepareTwoStepOrder
 * (CraftCloud order + bridge session already persisted) and after the
 * one-tap saved-card attempt returned null. On success the sentinel
 * is swapped for the PI id and the shipping address is persisted —
 * the order stays `cart_created` until the client confirms and
 * finalizeFeeAuthorization (or the webhook backstop) advances it.
 *
 * Returns null on ANY miss so the caller falls through to hosted
 * Checkout:
 *  - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not deployed — the Payment
 *    Element could never render client-side, so offering the sheet
 *    would hard-break checkout. This makes deploying the code before
 *    the env var a safe no-op.
 *  - customer resolution or PI creation failure (logged).
 *  - lost sentinel (another actor moved the order along).
 *
 * Idempotency: `fee-sheet:<orderId>` — a retried completePrintOrder
 * gets the SAME PaymentIntent back from Stripe instead of minting a
 * parallel one.
 */
async function prepareEmbeddedFeeSheet(
  order: typeof printOrders.$inferSelect,
  sentinel: string,
  contact: {
    email: string;
    shipping: Address;
    billing: Address & { isCompany: boolean; vatId?: string };
  }
): Promise<{
  clientSecret: string;
  orderId: string;
  amountCents: number;
  email: string;
} | null> {
  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) return null;

  let customerId: string;
  try {
    customerId = await getOrCreateStripeCustomer(order.userId, {
      email: contact.email,
    });
  } catch (err) {
    logError("completePrintOrder.feeSheet.customer", err);
    return null;
  }

  const stripe = getStripe();
  let intent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: order.serviceFee,
        currency: "usd",
        customer: customerId,
        capture_method: "manual",
        // Save the confirmed card for future one-tap fee
        // authorizations — same consent surface the Payment Element
        // renders for hosted Checkout's setup_future_usage.
        setup_future_usage: "off_session",
        // Pinned to card + Link. automatic_payment_methods with
        // allow_redirects: "never" is NOT enough here — it still lets
        // every non-redirect method the dashboard has enabled through,
        // e.g. us_bank_account's "search for your bank" UI, which is
        // exactly the slow, form-heavy surface this sheet exists to
        // avoid. (See SHEET_PAYMENT_METHOD_TYPES for the Link caveats.)
        payment_method_types: [...SHEET_PAYMENT_METHOD_TYPES],
        metadata: {
          printOrderId: order.id,
          type: "print_order",
          checkoutModel: "two_step",
          source: EMBEDDED_FEE_SHEET_SOURCE,
        },
      },
      // v4: the key changes every time the pinned method list does —
      // a remint after resolveEmbeddedFeePI cancels a stale PI must
      // not collide with the old key's params inside Stripe's 24h
      // idempotency window. (v2 = card+link, v3 = card only, v4 =
      // card+link again for the Express Checkout Link button.)
      { idempotencyKey: `fee-sheet:v4:${order.id}` }
    );
  } catch (err) {
    logError("completePrintOrder.feeSheet.createIntent", err);
    return null;
  }
  if (!intent.client_secret) return null;

  // Swap sentinel → PI id (the overloaded stripeSessionId column, same
  // convention as one-tap and agent charges) and persist the address
  // now — the confirm happens client-side, so this is the last moment
  // this server action holds the full contact payload.
  const swapped = await db
    .update(printOrders)
    .set({
      stripeSessionId: intent.id,
      shippingAddress: {
        email: contact.email,
        shipping: contact.shipping,
        billing: contact.billing,
      },
    })
    .where(
      and(
        eq(printOrders.id, order.id),
        eq(printOrders.status, "cart_created"),
        eq(printOrders.stripeSessionId, sentinel)
      )
    )
    .returning({ id: printOrders.id });

  if (swapped.length === 0) return null;

  return {
    clientSecret: intent.client_secret,
    orderId: order.id,
    amountCents: order.serviceFee,
    email: contact.email,
  };
}

/**
 * Re-entry handling for an order that already carries an embedded
 * fee-sheet PaymentIntent (user closed the sheet and clicked checkout
 * again, second tab, Resume from the dashboard). Distinguished from
 * agent off-session charges — which also park `pi_…` ids in
 * stripeSessionId at cart_created — by the PI's metadata.source, so
 * agent orders keep their existing "being placed" message.
 *
 * Outcomes:
 *  - "sheet"      — PI still confirmable → hand the same clientSecret
 *    back and reopen the sheet.
 *  - "authorized" — PI holds funds (requires_capture) but the row
 *    never advanced (finalize died / webhook lagging) → advance it
 *    now and go straight to CraftCloud.
 *  - "cleared"    — PI canceled → ref nulled, caller continues to
 *    mint a fresh checkout.
 *  - "not_sheet"  — not ours (agent charge) → caller keeps its
 *    existing behavior.
 *  - "error"      — terminal weirdness with a user-facing message.
 */
async function resolveEmbeddedFeePI(
  order: typeof printOrders.$inferSelect
): Promise<
  | { kind: "sheet"; clientSecret: string }
  | { kind: "authorized"; productionPaymentUrl: string }
  | { kind: "cleared" }
  | { kind: "not_sheet" }
  | { kind: "error"; message: string }
> {
  if (order.checkoutModel !== "two_step") return { kind: "not_sheet" };

  const stripe = getStripe();
  let intent: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>;
  try {
    intent = await stripe.paymentIntents.retrieve(order.stripeSessionId!);
  } catch (err) {
    logError("resolveEmbeddedFeePI.retrieve", err);
    return {
      kind: "error",
      message: "Could not check your payment. Please try again.",
    };
  }

  if (intent.metadata?.source !== EMBEDDED_FEE_SHEET_SOURCE) {
    return { kind: "not_sheet" };
  }

  switch (intent.status) {
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action": {
      if (!intent.client_secret) return { kind: "cleared" };
      // Heal PIs minted before the method list was pinned: a reused
      // PI renders whatever payment_method_types it was created with,
      // so a pre-pin PI would resurrect the us_bank_account picker on
      // every resume. Try to pin in place; PIs created under
      // automatic_payment_methods may refuse the update — cancel
      // those and clear the ref so the claim flow mints a fresh,
      // correctly-pinned PI instead.
      const currentTypes = intent.payment_method_types ?? [];
      const stale =
        currentTypes.some((t) => !SHEET_PAYMENT_METHOD_TYPES.includes(t)) ||
        SHEET_PAYMENT_METHOD_TYPES.some((t) => !currentTypes.includes(t));
      if (stale) {
        try {
          await stripe.paymentIntents.update(intent.id, {
            payment_method_types: [...SHEET_PAYMENT_METHOD_TYPES],
          });
        } catch (err) {
          logError("resolveEmbeddedFeePI.pinMethods", err);
          try {
            await stripe.paymentIntents.cancel(intent.id);
          } catch (cancelErr) {
            logError("resolveEmbeddedFeePI.pinMethods.cancel", cancelErr);
            return { kind: "sheet", clientSecret: intent.client_secret };
          }
          await db
            .update(printOrders)
            .set({ stripeSessionId: null })
            .where(
              and(
                eq(printOrders.id, order.id),
                eq(printOrders.stripeSessionId, intent.id)
              )
            );
          return { kind: "cleared" };
        }
      }
      return { kind: "sheet", clientSecret: intent.client_secret };
    }

    case "requires_capture": {
      const advanced = await advanceFeeAuthorizedOrder(order.id, intent.id);
      if (!advanced.ok) return { kind: "error", message: advanced.error };
      return { kind: "authorized", productionPaymentUrl: advanced.url };
    }

    case "canceled":
      // Clear the dead ref (conditionally — only if it's still this
      // PI) so the normal claim flow can mint a fresh checkout.
      await db
        .update(printOrders)
        .set({ stripeSessionId: null })
        .where(
          and(
            eq(printOrders.id, order.id),
            eq(printOrders.stripeSessionId, intent.id)
          )
        );
      return { kind: "cleared" };

    default:
      // processing / succeeded — shouldn't occur for a manual-capture
      // fee hold; don't touch anything.
      return {
        kind: "error",
        message:
          "This order is already being processed — check your orders in a moment.",
      };
  }
}

/**
 * Mock-mode healing for stored bridge session URLs. Before the
 * sandbox craftcloud-pay page existed, mock createStripeCheckout
 * persisted the returnUrl itself as bridgeSessionUrl — resuming such
 * an order would land on the orders tab with the production=paid
 * banner without any payment step, and the row would never advance.
 * Re-mint the mock bridge (which now points at the sandbox page) and
 * persist it. No-op against the live API or for already-healed URLs;
 * on any failure the stored URL is returned unchanged.
 */
async function healMockBridgeUrl(
  orderId: string,
  craftCloudOrderId: string | null,
  bridgeSessionUrl: string
): Promise<string> {
  if (!isMockCheckoutMode()) return bridgeSessionUrl;
  if (bridgeSessionUrl.includes("/sandbox/craftcloud-pay")) {
    return bridgeSessionUrl;
  }
  if (!craftCloudOrderId) return bridgeSessionUrl;
  try {
    const appUrl = await deriveAppUrl();
    const bridge = await createStripeCheckout({
      orderId: craftCloudOrderId,
      returnUrl: `${appUrl}/dashboard/orders?production=paid&orderId=${orderId}`,
      cancelUrl: `${appUrl}/orders/${orderId}/pay-production`,
      isTestOrder: isSandboxMode(),
    });
    await db
      .update(printOrders)
      .set({
        bridgeSessionId: bridge.sessionId,
        bridgeSessionUrl: bridge.sessionUrl,
      })
      .where(eq(printOrders.id, orderId));
    return bridge.sessionUrl;
  } catch (err) {
    logError("healMockBridgeUrl", err);
    return bridgeSessionUrl;
  }
}

/**
 * Shared advancement for a fee hold that exists on Stripe
 * (requires_capture) but whose row is still cart_created: the same
 * transition handleTwoStepFeeAuthorization performs for hosted
 * sessions. Conditional on the ref so a webhook race can't
 * double-apply; either winner leaves the row at
 * awaiting_production_payment.
 */
async function advanceFeeAuthorizedOrder(
  orderId: string,
  paymentIntentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const advanced = await db
    .update(printOrders)
    .set({
      status: "awaiting_production_payment",
      feePaymentIntentId: paymentIntentId,
      feeAuthorizedAt: new Date(),
    })
    .where(
      and(
        eq(printOrders.id, orderId),
        eq(printOrders.status, "cart_created"),
        eq(printOrders.stripeSessionId, paymentIntentId)
      )
    )
    .returning({ id: printOrders.id, userId: printOrders.userId });

  if (advanced.length > 0) {
    // Winner persists the saved card (fill-if-null) — the webhook
    // backstop's conditional UPDATE will lose and skip it.
    await persistSavedFeeCard(advanced[0].userId, paymentIntentId);
  }

  const [fresh] = await db
    .select({
      status: printOrders.status,
      bridgeSessionUrl: printOrders.bridgeSessionUrl,
      craftCloudOrderId: printOrders.craftCloudOrderId,
    })
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);

  if (fresh?.status !== "awaiting_production_payment") {
    logError(
      "advanceFeeAuthorizedOrder.writeLost",
      new Error(`fee-authorized advance lost for order ${orderId}`, {
        cause: { orderId, paymentIntentId, status: fresh?.status },
      })
    );
    return {
      ok: false,
      error:
        "This order is already being processed — check your orders in a moment.",
    };
  }
  if (!fresh.bridgeSessionUrl) {
    return {
      ok: false,
      error:
        "Your fee is authorized, but the production payment link is missing. Open your orders page and use Complete payment.",
    };
  }
  return {
    ok: true,
    url: await healMockBridgeUrl(
      orderId,
      fresh.craftCloudOrderId,
      fresh.bridgeSessionUrl
    ),
  };
}

/**
 * Called by the embedded fee sheet after the client-side
 * confirmPayment resolves: verify the hold actually exists on Stripe
 * (never trust the client), advance the order, and hand back
 * CraftCloud's payment URL. The `payment_intent.amount_capturable_updated`
 * webhook performs the same advancement as a backstop for clients
 * that die between confirm and this call — whichever runs first wins,
 * the other no-ops.
 */
export async function finalizeFeeAuthorization(
  orderId: string
): Promise<{ productionPaymentUrl: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [order] = await db
      .select()
      .from(printOrders)
      .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

    if (!order) return { error: "Order not found" };
    if (order.checkoutModel !== "two_step") {
      return { error: "Order not found" };
    }

    // Webhook (or a sibling call) already advanced it — idempotent.
    if (order.status === "awaiting_production_payment") {
      if (!order.bridgeSessionUrl) {
        return {
          error:
            "Your fee is authorized, but the production payment link is missing. Open your orders page and use Complete payment.",
        };
      }
      revalidatePath("/dashboard/orders");
      return {
        productionPaymentUrl: await healMockBridgeUrl(
          order.id,
          order.craftCloudOrderId,
          order.bridgeSessionUrl
        ),
      };
    }
    if (order.status !== "cart_created") {
      return { error: "Order already processed" };
    }

    if (classifyPaymentRef(order.stripeSessionId) !== "payment_intent") {
      return { error: "No payment is pending for this order" };
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(
      order.stripeSessionId!
    );
    if (
      intent.metadata?.printOrderId !== order.id ||
      intent.metadata?.source !== EMBEDDED_FEE_SHEET_SOURCE
    ) {
      return { error: "No payment is pending for this order" };
    }
    if (intent.status !== "requires_capture") {
      return {
        error: "Your payment hasn't completed yet. Please try again.",
      };
    }

    const advanced = await advanceFeeAuthorizedOrder(order.id, intent.id);
    if (!advanced.ok) return { error: advanced.error };

    revalidatePath("/dashboard/orders");
    return { productionPaymentUrl: advanced.url };
  } catch (error) {
    logError("finalizeFeeAuthorization", error);
    return { error: "Failed to confirm your payment. Please try again." };
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
 * The signed-in user's most recently used checkout address, pulled
 * from their newest print order that persisted one. Powers the
 * "deliver to your saved address" fast path in ShippingAddressForm —
 * returning buyers shouldn't retype an address we already shipped to.
 * No dedicated storage: order history IS the address book, so there's
 * nothing extra to keep in sync. Null (never an error) when signed
 * out or no prior order carries an address — the form just renders
 * blank.
 */
export async function getSavedShippingAddress(): Promise<
  | NonNullable<typeof printOrders.$inferSelect.shippingAddress>
  | null
> {
  try {
    const { userId } = await auth();
    if (!userId) return null;

    const [row] = await db
      .select({ shippingAddress: printOrders.shippingAddress })
      .from(printOrders)
      .where(
        and(
          eq(printOrders.userId, userId),
          isNotNull(printOrders.shippingAddress)
        )
      )
      .orderBy(desc(printOrders.createdAt))
      .limit(1);

    const saved = row?.shippingAddress;
    // Old rows may predate parts of the payload — only offer a saved
    // address that could pass the form's own required-field checks.
    if (
      !saved?.email ||
      !saved.shipping?.firstName ||
      !saved.shipping?.lastName ||
      !saved.shipping?.address ||
      !saved.shipping?.city ||
      !saved.shipping?.zipCode ||
      !saved.shipping?.countryCode ||
      !saved.billing
    ) {
      return null;
    }
    return saved;
  } catch (error) {
    logError("getSavedShippingAddress", error);
    return null;
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

    const stripe = getStripe();

    // Same multi-tab guard as completePrintOrder: if a real session
    // is already attached, retrieve it; if it's open, return that URL
    // so two Resume clicks across tabs land on the same Stripe page.
    // Skip claim sentinels — they signal a sibling worker is mid-flight
    // and the lost-race branch below handles the wait. A `pi_…` value
    // means this order was auto-approved and charged off-session by an
    // agent (CON-159) — it's awaiting CraftCloud placement by the
    // place-auto-approved-orders cron and there's no Checkout session
    // to resume, regardless of whether craftCloudOrderId has landed
    // yet. Bail with a friendly message instead of letting
    // sessions.retrieve throw (MTR-233).
    const resumeRefKind = classifyPaymentRef(order.stripeSessionId);
    if (resumeRefKind === "payment_intent") {
      const resolved = await resolveEmbeddedFeePI(order);
      if (resolved.kind === "authorized") {
        return { checkoutUrl: resolved.productionPaymentUrl };
      }
      if (resolved.kind === "error") {
        return { error: resolved.message };
      }
      if (resolved.kind === "not_sheet") {
        return { error: AGENT_CHARGED_ORDER_ERROR };
      }
      if (resolved.kind === "sheet") {
        // Resume speaks URLs (the dashboard Resume button redirects),
        // not in-page sheets — cancel the unconfirmed sheet PI and
        // fall through to mint a hosted session from the stored
        // address. No hold exists yet, so cancellation is free.
        try {
          await stripe.paymentIntents.cancel(order.stripeSessionId!);
        } catch (err) {
          logError("resumePrintOrder.cancelSheetIntent", err);
        }
        await db
          .update(printOrders)
          .set({ stripeSessionId: null })
          .where(
            and(
              eq(printOrders.id, orderId),
              eq(printOrders.stripeSessionId, order.stripeSessionId!)
            )
          );
      }
      // "cleared" (and post-cancel "sheet") fall through to the
      // normal claim flow below.
    }
    if (resumeRefKind === "session") {
      const resumeSessionId = order.stripeSessionId!;
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          resumeSessionId
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
              eq(printOrders.stripeSessionId, resumeSessionId)
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
      const refreshedResumeRefKind = classifyPaymentRef(
        refreshed.stripeSessionId
      );
      if (refreshedResumeRefKind === "payment_intent") {
        return { error: AGENT_CHARGED_ORDER_ERROR };
      }
      if (refreshedResumeRefKind === "session") {
        try {
          const existing = await stripe.checkout.sessions.retrieve(
            refreshed.stripeSessionId!
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
    return {
      checkoutUrl: await healMockBridgeUrl(
        order.id,
        order.craftCloudOrderId,
        order.bridgeSessionUrl
      ),
    };
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

    // stripeSessionId is an overloaded column (AGENTS.md): agent
    // auto-approved orders store the off-session PaymentIntent id
    // (pi_…) here directly rather than a Checkout session id, and a
    // session_claim:<nanoid> sentinel can be present mid-resume. Never
    // call sessions.retrieve on either — sessions.retrieve("pi_…")
    // throws (silently swallowed by the catch below, surfacing a
    // generic "contact support" error despite the money and PI id
    // being right there), and a claim sentinel isn't a real payment
    // reference at all.
    const refundRefKind = classifyPaymentRef(order.stripeSessionId);
    if (refundRefKind === "claim") {
      return { error: "No payment found for this order" };
    }

    const stripe = getStripe();
    let paymentIntentId: string;

    if (refundRefKind === "payment_intent") {
      // Auto-approved agent order — stripeSessionId IS the
      // PaymentIntent id (lib/mcp/internal/orders.ts:353). Refund it
      // directly, mirroring cancelAutoApprovedOrder in
      // app/actions/agent-orders.ts.
      paymentIntentId = order.stripeSessionId;
    } else {
      // Normal Checkout-session-backed order — resolve the payment
      // intent from the session.
      const session = await stripe.checkout.sessions.retrieve(
        order.stripeSessionId
      );

      if (!session.payment_intent) {
        return { error: "No payment intent found" };
      }

      paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id;
    }

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
