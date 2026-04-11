import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders, fileAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { OrderStatusTracker } from "@/components/print/order-status-tracker";
import { FacilityMap } from "@/components/print/facility-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMaterialById } from "@/lib/materials";
import { getShipmentOrigin } from "@/lib/vendors/data";
import { formatOrderNumber } from "@/lib/utils/order-number";

const STATUS_LABELS: Record<string, string> = {
  quoting: "Quoting",
  cart_created: "Pending Payment",
  ordered: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  received: "Delivered",
  cancelled: "Cancelled",
};

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

  const materialMeta = order.material ? getMaterialById(order.material) : null;
  const shipmentOrigin = getShipmentOrigin(order.trackingInfo);
  const orderNumber = formatOrderNumber(order.id);
  const statusLabel = STATUS_LABELS[order.status] || order.status;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {searchParams.payment === "success" && (
        <Alert className="mb-6 border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <p className="text-sm font-medium">Payment confirmed</p>
          <p className="text-xs mt-1">
            Your print has been sent to production. We&apos;ll keep you updated.
          </p>
        </Alert>
      )}

      {searchParams.payment === "cancelled" && (
        <Alert variant="destructive" className="mb-6">
          <p className="text-sm font-medium">Payment cancelled</p>
          <p className="text-xs mt-1">
            No charges were made. You can retry from your orders page.
          </p>
        </Alert>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Order {orderNumber}</p>
          <h1 className="text-2xl font-bold mt-0.5">
            {materialMeta?.name || order.material || "3D Print"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {order.filename}
            {materialMeta && ` · ${materialMeta.method}`}
          </p>
        </div>
        <Badge
          variant={order.status === "cancelled" ? "destructive" : "outline"}
        >
          {statusLabel}
        </Badge>
      </div>

      {/* Status tracker */}
      <div className="mt-8">
        <OrderStatusTracker
          currentStatus={order.status}
          trackingInfo={order.trackingInfo}
        />
      </div>

      {/* Info grid */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Shipment origin map — only shown when we have real tracking data */}
        {shipmentOrigin && <FacilityMap origin={shipmentOrigin} />}

        {/* Price breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Price Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Production</span>
              <span>${(order.totalPrice / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service fee</span>
              <span>${(order.serviceFee / 100).toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>
                ${((order.totalPrice + order.serviceFee) / 100).toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Material info */}
      {materialMeta && (
        <Card className="mt-4">
          <CardContent className="p-4 flex items-center gap-4">
            <div
              className="h-10 w-10 rounded-md shrink-0 border border-border"
              style={{
                background: `linear-gradient(135deg, ${materialMeta.color}, ${materialMeta.color}dd)`,
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{materialMeta.name}</p>
              <p className="text-xs text-muted-foreground">
                {materialMeta.method} · {materialMeta.category}
              </p>
            </div>
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              {(["strength", "flexibility", "detail"] as const).map((prop) => (
                <div key={prop} className="flex items-center gap-0.5">
                  <span className="capitalize">{prop.slice(0, 3)}</span>
                  <div className="flex gap-px">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 w-1 rounded-full ${
                          i < materialMeta.properties[prop]
                            ? "bg-foreground/50"
                            : "bg-foreground/10"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 text-xs text-muted-foreground">
        Ordered{" "}
        {order.createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>
    </div>
  );
}
