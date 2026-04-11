"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders, fileAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createCart, createOrder, getOrderStatus } from "@/lib/craftcloud/client";
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
}) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const totalPrice = Math.round(
    (params.materialPrice * params.quantity + params.shippingPrice) * 100
  );
  const serviceFee = Math.round(totalPrice * SERVICE_FEE_RATE);

  // Create Craft Cloud cart
  const cart = await createCart({
    shippingIds: [params.shippingId],
    currency: params.currency,
    quotes: [
      {
        quoteId: params.quoteId,
        vendorId: params.vendorId,
        modelId: "", // filled by Craft Cloud from quote
        materialConfigId: params.materialConfigId,
        quantity: params.quantity,
      },
    ],
  });

  // Create print order record
  const [order] = await db
    .insert(printOrders)
    .values({
      userId,
      fileAssetId: params.fileAssetId,
      craftCloudCartId: cart.cartId,
      totalPrice,
      serviceFee,
      material: params.materialConfigId,
      vendor: params.vendorId,
      status: "cart_created",
    })
    .returning();

  revalidatePath("/dashboard/orders");
  return { orderId: order.id, cartId: cart.cartId };
}

export async function checkOrderStatus(orderId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const [order] = await db
    .select()
    .from(printOrders)
    .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

  if (!order || !order.craftCloudOrderId) return null;

  const status = await getOrderStatus(order.craftCloudOrderId);
  const vendorStatus = status.vendorStatuses[0];

  // Map Craft Cloud status to our DB enum (CC has "blocked" which we map to "cancelled")
  const STATUS_MAP: Record<string, typeof order.status> = {
    ordered: "ordered",
    in_production: "in_production",
    shipped: "shipped",
    received: "received",
    blocked: "cancelled",
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
}
