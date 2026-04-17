import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  printOrders,
  printOrderItems,
  fileAssets,
  files,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { CheckoutForm } from "@/components/checkout/checkout-form";

/**
 * Checkout page for a `cart_created` print order. Reached via the
 * cart panel's Checkout button after `checkoutVendorGroup` has
 * committed the CraftCloud cart and created the print order row —
 * this is where the user enters their shipping address and is then
 * redirected to Stripe.
 *
 * Legacy single-item orders (fileAssetId set directly on printOrders)
 * skip this page because the quote configurator collects the address
 * inline before calling completePrintOrder. For multi-item orders
 * there's no inline step, so we land here instead.
 */
export default async function CheckoutPage(props: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await props.params;
  const { userId } = await auth();
  if (!userId) redirect("/");

  const [order] = await db
    .select()
    .from(printOrders)
    .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

  if (!order) notFound();

  // Already paid (or beyond) — send them to the order detail page.
  if (order.status !== "cart_created") {
    redirect(`/dashboard/orders/${orderId}`);
  }

  // Build the line items. Multi-item orders pull from printOrderItems;
  // legacy single-item orders reconstitute from the printOrders row.
  const items = order.fileAssetId
    ? await db
        .select({
          fileName: files.name,
          originalFilename: fileAssets.originalFilename,
          quantity: printOrders.quantity,
          materialSubtotal: printOrders.materialSubtotal,
        })
        .from(printOrders)
        .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
        .leftJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(printOrders.id, orderId))
    : await db
        .select({
          fileName: files.name,
          originalFilename: fileAssets.originalFilename,
          quantity: printOrderItems.quantity,
          materialSubtotal: printOrderItems.materialSubtotal,
        })
        .from(printOrderItems)
        .innerJoin(fileAssets, eq(printOrderItems.fileAssetId, fileAssets.id))
        .leftJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(printOrderItems.printOrderId, orderId));

  // Shipping lives canonically on the order row (not on each item —
  // items used to carry a copy of the vendor's fee and summing them
  // double-charged). For legacy rows where the column is null, show
  // zero here; the order row's totalPrice already reflects reality.
  const totalShipping = order.shippingSubtotal ?? 0;

  // Production fee surfaced as an implied line: whatever isn't
  // explained by material + shipping must be the vendor's
  // minimum-production charge.
  const totalMaterial = items.reduce(
    (sum, i) => sum + (i.materialSubtotal ?? 0) * (i.quantity ?? 1),
    0
  );
  const impliedProductionFee = Math.max(
    0,
    order.totalPrice - totalMaterial - totalShipping
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <CheckoutForm
        orderId={order.id}
        items={items.map((i) => ({
          fileName: i.fileName,
          originalFilename: i.originalFilename,
          quantity: i.quantity ?? 1,
          materialSubtotal: i.materialSubtotal ?? 0,
        }))}
        shippingTotal={totalShipping}
        productionFee={impliedProductionFee}
        totalPrice={order.totalPrice}
        serviceFee={order.serviceFee}
      />
    </div>
  );
}
