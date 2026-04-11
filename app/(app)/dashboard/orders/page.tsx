import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const orders = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.userId, userId))
    .orderBy(desc(printOrders.createdAt));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Print Orders</h1>
      {orders.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-foreground/60">
            No print orders yet. Print a file to get started.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between rounded-lg border border-foreground/10 p-4"
            >
              <div>
                <p className="font-medium">
                  Order {order.craftCloudOrderId || order.id.slice(0, 8)}
                </p>
                <p className="text-sm text-foreground/60">
                  {order.material} &middot; {order.vendor}
                </p>
              </div>
              <div className="text-right">
                <span className="rounded bg-foreground/10 px-2 py-0.5 text-xs">
                  {order.status}
                </span>
                <p className="mt-1 text-sm">
                  ${((order.totalPrice + order.serviceFee) / 100).toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
