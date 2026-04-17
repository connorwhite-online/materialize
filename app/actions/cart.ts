"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { cartItems, fileAssets, files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { addToCartSchema } from "@/lib/validations/print";
import { logError } from "@/lib/logger";

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
};

export async function addToCart(params: {
  fileAssetId: string;
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

    const [item] = await db
      .insert(cartItems)
      .values({
        userId,
        fileAssetId: data.fileAssetId,
        quoteId: data.quoteId,
        vendorId: data.vendorId,
        vendorName: data.vendorName ?? null,
        materialConfigId: data.materialConfigId,
        shippingId: data.shippingId,
        quantity: data.quantity,
        materialPrice: Math.round(data.materialPrice * 100),
        shippingPrice: Math.round(data.shippingPrice * 100),
        currency: data.currency,
        countryCode: data.countryCode,
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
      })
      .from(cartItems)
      .innerJoin(fileAssets, eq(cartItems.fileAssetId, fileAssets.id))
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(cartItems.userId, userId))
      .orderBy(cartItems.createdAt);

    return { items: rows };
  } catch (error) {
    logError("getCart", error);
    return { error: "Failed to load cart" };
  }
}

export async function getCartItemCount(): Promise<number> {
  try {
    const { userId } = await auth();
    if (!userId) return 0;

    const rows = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(eq(cartItems.userId, userId));

    return rows.length;
  } catch (error) {
    logError("getCartItemCount", error);
    return 0;
  }
}
