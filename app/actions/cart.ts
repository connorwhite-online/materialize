"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { cartItems, fileAssets, files } from "@/lib/db/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { addToCartSchema } from "@/lib/validations/print";
import { userCanPrintAsset } from "@/lib/entitlement";
import { logError } from "@/lib/logger";
import { getPrice, CraftCloudApiError } from "@/lib/craftcloud/client";

const QUOTE_EXPIRED_ERROR =
  "This quote has expired. Please pick a material again — prices may have changed.";

// Rounding-only tolerance — see the identical constant + rationale in
// app/actions/print.ts (duplicated rather than extracted into a shared
// helper; MTR-162 tracks that extraction as a deliberate follow-up
// AFTER this money-critical change lands). MTR-130.
const PRICE_RECONCILE_TOLERANCE_CENTS = 1;

/**
 * Re-derive the authoritative per-unit material price for a quote
 * from CraftCloud instead of trusting the client-supplied
 * materialPrice. See app/actions/print.ts's twin for the full
 * rationale — kept in sync there.
 */
async function reconcileMaterialPrice(params: {
  priceId: string;
  quoteId: string;
  claimedPriceCents: number;
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

export type CartItemWithMeta = {
  id: string;
  fileAssetId: string;
  fileName: string | null;
  originalFilename: string;
  vendorId: string;
  vendorName: string | null;
  materialConfigId: string;
  shippingId: string;
  quoteId: string;
  quantity: number;
  materialPrice: number;
  shippingPrice: number;
  currency: string;
  countryCode: string;
  /** ISO timestamp the cart row was last written. */
  updatedAt: string;
};

export async function addToCart(params: {
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
  currency: string;
  countryCode: string;
}): Promise<{ cartItemId: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const parsed = addToCartSchema.safeParse(params);
    if (!parsed.success) return { error: "Invalid cart item parameters" };

    const data = parsed.data;

    // Only the owner of the asset (or anyone, for a published listing)
    // may cart/print it — blocks adding another user's private/draft
    // asset by a guessed id. (CON-73)
    if (!(await userCanPrintAsset(userId, data.fileAssetId))) {
      return { error: "File not found" };
    }

    // Re-derive the authoritative per-unit price from CraftCloud
    // instead of trusting the client-supplied materialPrice — a
    // tampered add-to-cart write must not persist into the cart row
    // that checkoutVendorGroup later sums into the charge (MTR-130).
    const reconciled = await reconcileMaterialPrice({
      priceId: data.priceId,
      quoteId: data.quoteId,
      claimedPriceCents: Math.round(data.materialPrice * 100),
    });
    if (!reconciled.ok) return { error: reconciled.error };

    // Reject cart lines in a different currency than what's already
    // in the cart. CraftCloud quotes are currency-scoped and
    // checkoutVendorGroup only sends one currency per cart create —
    // mixing would silently ignore all but the first item's currency
    // (and likely 400 at the CraftCloud boundary). Force the user to
    // clear or finish the existing cart first.
    const [anyExisting] = await db
      .select({ currency: cartItems.currency })
      .from(cartItems)
      .where(eq(cartItems.userId, userId));

    if (anyExisting && anyExisting.currency !== data.currency) {
      return {
        error: `Your cart is in ${anyExisting.currency}. Clear it or finish that order before adding ${data.currency} items.`,
      };
    }

    // One shipping option per vendor cart. CraftCloud bills shipping
    // once per vendor-group order, and `checkoutVendorGroup` collapses
    // the group's shippingIds — so a second item for a vendor the user
    // already has a cart with must adopt that cart's shipping choice
    // rather than carry its own (which would split the group across two
    // shipping methods and confuse the deduped total). Inherit the
    // existing group's shippingId/price; the new item's own selection
    // is intentionally ignored here. Stored prices are already in cents.
    const [existingForVendor] = await db
      .select({
        shippingId: cartItems.shippingId,
        shippingPrice: cartItems.shippingPrice,
      })
      .from(cartItems)
      .where(
        and(
          eq(cartItems.userId, userId),
          eq(cartItems.vendorId, data.vendorId)
        )
      )
      .limit(1);

    const shippingIdToUse = existingForVendor?.shippingId ?? data.shippingId;
    const shippingPriceCents = existingForVendor
      ? existingForVendor.shippingPrice
      : Math.round(data.shippingPrice * 100);

    // Merge duplicates atomically: a "duplicate" is
    // (userId, fileAssetId, quoteId) — the quoteId already encodes
    // vendor + material + shipping on CraftCloud's side, so two rows
    // with the same quoteId are definitionally the same cart line.
    // The previous SELECT-then-INSERT pattern raced when a user
    // double-clicked Add — both requests passed the existence check
    // and both inserted. The (user, file, quote) UNIQUE INDEX added
    // in migration 0005 makes ON CONFLICT DO UPDATE the right shape
    // here: postgres serializes the upsert and bumps the keeper row's
    // quantity instead of producing a sibling row.
    const [item] = await db
      .insert(cartItems)
      .values({
        userId,
        fileAssetId: data.fileAssetId,
        priceId: data.priceId,
        quoteId: data.quoteId,
        vendorId: data.vendorId,
        vendorName: data.vendorName ?? null,
        materialConfigId: data.materialConfigId,
        shippingId: shippingIdToUse,
        quantity: data.quantity,
        materialPrice: reconciled.priceCents,
        shippingPrice: shippingPriceCents,
        currency: data.currency,
        countryCode: data.countryCode,
      })
      .onConflictDoUpdate({
        target: [cartItems.userId, cartItems.fileAssetId, cartItems.quoteId],
        set: {
          quantity: sql`LEAST(100, ${cartItems.quantity} + EXCLUDED.quantity)`,
          // Bump updatedAt so cart-staleness UI reflects the latest
          // touch (the `$onUpdate` only fires on full UPDATE statements,
          // not the implicit one inside ON CONFLICT DO UPDATE).
          updatedAt: new Date(),
        },
      })
      .returning({ id: cartItems.id });

    revalidatePath("/");
    return { cartItemId: item.id };
  } catch (error) {
    logError("addToCart", error);
    return { error: "Failed to add item to cart" };
  }
}

export async function removeFromCart(
  cartItemId: string
): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const [item] = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    if (!item) return { error: "Cart item not found" };

    await db.delete(cartItems).where(eq(cartItems.id, cartItemId));

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logError("removeFromCart", error);
    return { error: "Failed to remove item from cart" };
  }
}

export async function updateCartItemQuantity(
  cartItemId: string,
  quantity: number
): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return { error: "Invalid quantity" };
    }

    const [item] = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    if (!item) return { error: "Cart item not found" };

    await db
      .update(cartItems)
      .set({ quantity })
      .where(eq(cartItems.id, cartItemId));

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logError("updateCartItemQuantity", error);
    return { error: "Failed to update quantity" };
  }
}

/**
 * Persist a fresh CraftCloud quote for a cart line after the user
 * changed its quantity. Unlike `updateCartItemQuantity` (a bare
 * quantity write), this also swaps in the re-quoted per-unit price and
 * quoteId so the line reflects the vendor's real volume pricing — a
 * +1 in the cart should drop the per-unit price, not flat-multiply the
 * old one. The client fetches the new quote (re-running the price
 * request at the new quantity) and hands the resolved values here.
 *
 * Shipping is deliberately untouched: CraftCloud bills it once per
 * vendor order regardless of unit count, so a quantity change doesn't
 * re-quote freight.
 */
export async function repriceCartItem(params: {
  cartItemId: string;
  quantity: number;
  quoteId: string;
  /** Re-quoted per-unit material price, in dollars. */
  materialPrice: number;
}): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    if (
      !Number.isInteger(params.quantity) ||
      params.quantity < 1 ||
      params.quantity > 100
    ) {
      return { error: "Invalid quantity" };
    }
    if (!params.quoteId || !(params.materialPrice > 0)) {
      return { error: "Invalid quote" };
    }

    const [item] = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(
        and(eq(cartItems.id, params.cartItemId), eq(cartItems.userId, userId))
      );

    if (!item) return { error: "Cart item not found" };

    await db
      .update(cartItems)
      .set({
        quantity: params.quantity,
        quoteId: params.quoteId,
        // The caller re-quotes at the new quantity but doesn't hand
        // back the priceId that quote came from — null it out rather
        // than leaving the OLD priceId paired with the NEW quoteId.
        // checkoutVendorGroup's reconciliation (MTR-130) looks up
        // quoteId inside getPrice(priceId)'s response; a stale
        // priceId would never contain the new quoteId and would
        // false-reject checkout. A null priceId instead falls into
        // the same best-effort "can't reconcile, trust as written"
        // bucket as any other legacy row.
        priceId: null,
        materialPrice: Math.round(params.materialPrice * 100),
        updatedAt: new Date(),
      })
      .where(eq(cartItems.id, params.cartItemId));

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    logError("repriceCartItem", error);
    return { error: "Failed to update quantity" };
  }
}

export async function getCart(): Promise<
  { items: CartItemWithMeta[] } | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { items: [] };

    const rows = await db
      .select({
        id: cartItems.id,
        fileAssetId: cartItems.fileAssetId,
        fileName: files.name,
        originalFilename: fileAssets.originalFilename,
        vendorId: cartItems.vendorId,
        vendorName: cartItems.vendorName,
        materialConfigId: cartItems.materialConfigId,
        shippingId: cartItems.shippingId,
        quoteId: cartItems.quoteId,
        quantity: cartItems.quantity,
        materialPrice: cartItems.materialPrice,
        shippingPrice: cartItems.shippingPrice,
        currency: cartItems.currency,
        countryCode: cartItems.countryCode,
        updatedAt: cartItems.updatedAt,
      })
      .from(cartItems)
      .innerJoin(fileAssets, eq(cartItems.fileAssetId, fileAssets.id))
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(cartItems.userId, userId))
      .orderBy(cartItems.createdAt);

    return {
      items: rows.map((r) => ({
        ...r,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    logError("getCart", error);
    return { error: "Failed to load cart" };
  }
}

export async function getCartItemCount(): Promise<number> {
  try {
    const { userId } = await auth();
    if (!userId) return 0;

    // Use COUNT(*) instead of pulling every id back. Called from the
    // cart-count nav context on every page render — the count helper
    // returns a single integer instead of N uuids over the wire.
    const [row] = await db
      .select({ count: count() })
      .from(cartItems)
      .where(eq(cartItems.userId, userId));

    return row?.count ?? 0;
  } catch (error) {
    logError("getCartItemCount", error);
    return 0;
  }
}
