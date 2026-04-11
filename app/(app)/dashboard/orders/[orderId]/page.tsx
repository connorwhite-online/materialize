import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders, fileAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { OrderStatusTracker } from "@/components/print/order-status-tracker";

export default async function OrderDetailPage(props: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await props.params;
  const { userId } = await auth();
  if (!userId) return null;

  const [order] = await db
    .select({
      id: printOrders.id,
      status: printOrders.status,
      totalPrice: printOrders.totalPrice,
      serviceFee: printOrders.serviceFee,
      material: printOrders.material,
      vendor: printOrders.vendor,
      trackingInfo: printOrders.trackingInfo,
      craftCloudOrderId: printOrders.craftCloudOrderId,
      createdAt: printOrders.createdAt,
      filename: fileAssets.originalFilename,
    })
    .from(printOrders)
    .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
    .where(and(eq(printOrders.id, orderId), eq(printOrders.userId, userId)));

  if (!order) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">
        Order {order.craftCloudOrderId || order.id.slice(0, 8)}
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        {order.filename} &middot; {order.material} &middot; {order.vendor}
      </p>

      <div className="mt-8">
        <OrderStatusTracker
          currentStatus={order.status}
          trackingInfo={order.trackingInfo}
        />
      </div>

      <div className="mt-8 rounded-lg border border-foreground/10 p-6">
        <h2 className="font-semibold">Price Breakdown</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-foreground/60">Print cost</span>
            <span>${(order.totalPrice / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground/60">Service fee (8%)</span>
            <span>${(order.serviceFee / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-foreground/10 pt-2 font-semibold">
            <span>Total</span>
            <span>
              ${((order.totalPrice + order.serviceFee) / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-foreground/40">
        Created{" "}
        {order.createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>
    </div>
  );
}
