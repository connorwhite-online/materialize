import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  printOrders,
  printOrderItems,
  fileAssets,
  files,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { loadPreviewView } from "@/lib/files/load-preview-view";
import { getMaterialById } from "@/lib/materials";
import { formatOrderNumber } from "@/lib/utils/order-number";
import { OrderDetailView } from "./order-detail-view";

export default async function OrderDetailPage(props: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { orderId } = await props.params;
  const searchParams = await props.searchParams;
  const { userId } = await auth();
  if (!userId) return null;

  const [order] = await db
    .select({
      id: printOrders.id,
      status: printOrders.status,
      totalPrice: printOrders.totalPrice,
      serviceFee: printOrders.serviceFee,
      materialSubtotal: printOrders.materialSubtotal,
      shippingSubtotal: printOrders.shippingSubtotal,
      quantity: printOrders.quantity,
      material: printOrders.material,
      vendor: printOrders.vendor,
      vendorName: printOrders.vendorName,
      trackingInfo: printOrders.trackingInfo,
      craftCloudOrderId: printOrders.craftCloudOrderId,
      createdAt: printOrders.createdAt,
      filename: files.name,
      listingFileId: files.id,
      originalFilename: fileAssets.originalFilename,
      fileAssetId: printOrders.fileAssetId,
      assetFormat: fileAssets.format,
    })
    .from(printOrders)
    .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

  if (!order) notFound();

  // `cart_created` = user picked a material but bailed before entering
  // address / paying. Legacy single-item drafts bounce back into the
  // quote configurator; multi-item drafts go to the checkout address
  // page (no inline address step to land on).
  if (order.status === "cart_created") {
    if (order.fileAssetId) {
      const qs = order.material ? `?material=${order.material}` : "";
      redirect(`/print/${order.fileAssetId}${qs}`);
    } else {
      redirect(`/checkout/${order.id}`);
    }
  }

  // Multi-item orders (`fileAssetId` is null on the parent row) —
  // pull the printOrderItems children so we can render filename +
  // model preview + material meta from the first item, same pattern
  // as the orders list and drafts queries.
  const items = order.fileAssetId
    ? []
    : await db
        .select({
          fileAssetId: printOrderItems.fileAssetId,
          materialConfigId: printOrderItems.materialConfigId,
          quantity: printOrderItems.quantity,
          materialSubtotal: printOrderItems.materialSubtotal,
          fileName: files.name,
          listingFileId: files.id,
          originalFilename: fileAssets.originalFilename,
          assetFormat: fileAssets.format,
        })
        .from(printOrderItems)
        .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
        .leftJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(printOrderItems.printOrderId, order.id))
        .orderBy(asc(printOrderItems.createdAt));

  // Resolve the best display values: direct columns for single-item
  // orders, first printOrderItem for multi-item. Material meta only
  // resolves against our curated catalog (not CraftCloud UUIDs), so
  // multi-item orders just get no chip — acceptable soft degrade.
  const firstItem = items[0];
  const extraItemCount = Math.max(0, items.length - 1);
  const previewFileId = order.listingFileId ?? firstItem?.listingFileId ?? null;
  // Same fail-soft loader as /files/[slug] and /print/[fileAssetId]
  // — a missing snapshot (or a schema that lags the deploy) costs
  // the camera angle, not the order page.
  const previewView = previewFileId
    ? await loadPreviewView(previewFileId)
    : null;

  const displayFilename =
    order.filename ??
    order.originalFilename?.replace(/\.[^.]+$/, "") ??
    firstItem?.fileName ??
    firstItem?.originalFilename?.replace(/\.[^.]+$/, "") ??
    null;

  const previewFileAssetId = order.fileAssetId ?? firstItem?.fileAssetId ?? null;
  const previewFormat = order.assetFormat ?? firstItem?.assetFormat ?? null;
  const displayMaterialId = order.material ?? firstItem?.materialConfigId ?? null;

  const materialMeta = displayMaterialId ? getMaterialById(displayMaterialId) : null;
  const displayVendorName = order.vendorName ?? order.vendor ?? null;
  const orderNumber = formatOrderNumber(order.id);

  // Price breakdown — split the lumped totalPrice into its
  // components so the user can see what they paid for. Production
  // fee is anything left over after material + shipping; it only
  // surfaces when the vendor's minimum exceeded the quoted price.
  const breakdownMaterial = order.fileAssetId
    ? (order.materialSubtotal ?? 0) * (order.quantity ?? 1)
    : items.reduce((sum, i) => sum + i.materialSubtotal * i.quantity, 0);
  const breakdownShipping = order.shippingSubtotal ?? 0;
  const breakdownProductionFee = Math.max(
    0,
    order.totalPrice - breakdownMaterial - breakdownShipping
  );

  const title = displayFilename
    ? extraItemCount > 0
      ? `${displayFilename} + ${extraItemCount} more`
      : displayFilename
    : materialMeta?.name || "3D print";
  const quantityLabel =
    order.fileAssetId && order.quantity && order.quantity > 1
      ? `× ${order.quantity}`
      : items.length > 1
        ? `(${items.length} items)`
        : null;

  return (
    <OrderDetailView
      order={{
        id: order.id,
        status: order.status,
        orderNumber,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        serviceFee: order.serviceFee,
        trackingInfo: order.trackingInfo,
      }}
      title={title}
      vendorName={displayVendorName}
      material={
        materialMeta
          ? {
              name: materialMeta.name,
              method: materialMeta.method,
              color: materialMeta.color,
            }
          : null
      }
      quantityLabel={quantityLabel}
      breakdown={{
        material: breakdownMaterial,
        productionFee: breakdownProductionFee,
        shipping: breakdownShipping,
      }}
      preview={
        previewFileAssetId && previewFormat
          ? {
              fileAssetId: previewFileAssetId,
              format: previewFormat,
              color: materialMeta?.color ?? "#a1a1aa",
              initialView: previewView,
              extraItemCount,
            }
          : null
      }
      payment={searchParams.payment}
    />
  );
}
