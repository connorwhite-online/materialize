import Link from "next/link";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMaterialById } from "@/lib/materials";
import { formatOrderNumber } from "@/lib/utils/order-number";

const STATUS_LABELS: Record<string, string> = {
  quoting: "Quoting",
  cart_created: "Pending Payment",
  ordered: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  received: "Delivered",
  blocked: "Needs Attention",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  quoting: "outline",
  cart_created: "outline",
  ordered: "secondary",
  in_production: "secondary",
  shipped: "default",
  received: "default",
  blocked: "destructive",
  refunded: "secondary",
  cancelled: "destructive",
};

export async function OrdersTab({ userId }: { userId: string }) {
  const orders = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.userId, userId))
    .orderBy(desc(printOrders.createdAt));

  if (orders.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">No print orders yet.</p>
        <Button variant="outline" className="mt-4" render={<Link href="/print" />}>
          Print a file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const materialMeta = order.material
          ? getMaterialById(order.material)
          : null;
        const orderNumber = formatOrderNumber(order.id);
        const statusLabel = STATUS_LABELS[order.status] || order.status;
        const variant = STATUS_VARIANT[order.status] || "outline";

        return (
          <Link key={order.id} href={`/dashboard/orders/${order.id}`}>
            <Card className="transition-colors hover:border-primary/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {materialMeta && (
                    <div
                      className="h-8 w-8 rounded-md border border-border shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${materialMeta.color}, ${materialMeta.color}dd)`,
                      }}
                    />
                  )}
                  <div>
                    <p className="font-medium text-sm">
                      {materialMeta?.name || order.material || "3D Print"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {orderNumber}
                      {materialMeta && ` · ${materialMeta.method}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant={variant}>{statusLabel}</Badge>
                  <p className="text-sm font-medium w-20 text-right tabular-nums">
                    $
                    {((order.totalPrice + order.serviceFee) / 100).toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
