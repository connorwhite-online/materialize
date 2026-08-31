import Link from "next/link";
import { db } from "@/lib/db";
import {
  printOrders,
  printOrderItems,
  fileAssets,
  files,
} from "@/lib/db/schema";
import { eq, desc, and, inArray, notInArray, asc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMaterialById } from "@/lib/materials";
import { formatOrderNumber } from "@/lib/utils/order-number";
import { DraftCartCard } from "./draft-cart-card";

export const STATUS_LABELS: Record<string, string> = {
  quoting: "Quoting",
  awaiting_agent_approval: "Awaiting Approval",
  auto_approved: "Approved — Placing Soon",
  cart_created: "Pending Payment",
  awaiting_production_payment: "Awaiting production payment",
  ordered: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  received: "Delivered",
  blocked: "Needs Attention",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  quoting: "outline",
  awaiting_agent_approval: "outline",
  auto_approved: "secondary",
  cart_created: "outline",
  awaiting_production_payment: "outline",
  ordered: "secondary",
  in_production: "secondary",
  shipped: "default",
  received: "default",
  blocked: "destructive",
  refunded: "secondary",
  cancelled: "destructive",
};

// In-progress rows that surface in the "Carts" section with a Resume /
// Complete-payment action instead of the read-only orders list:
//   - cart_created — user bailed before paying our Stripe checkout.
//   - awaiting_production_payment — two_step orders where the service-fee
//     hold succeeded but the customer hasn't paid CraftCloud yet.
const IN_PROGRESS_STATUSES = [
  "cart_created",
  "awaiting_production_payment",
] as const;

// Cap the finished-orders history fetch at a user-friendly ceiling —
// mirrors LIBRARY_MAX_FILES in library-tab.tsx. Without a limit, a
// customer with a long print history (plus the multiItemOrderMeta
// inArray fan-out below) loads their entire lifetime order list on
// every visit; cost grows unboundedly with account age. A truncation
// notice flags the cap so nothing silently disappears.
const ORDERS_MAX = 100;

export async function OrdersTab({ userId }: { userId: string }) {
  // In-progress rows surface separately as a "Carts" section with
  // Resume / Discard actions — they're not finished orders yet.
  // Same-user filter on both → fan them out in one roundtrip.
  const [draftsRaw, ordersRawUncapped] = await Promise.all([
    db
      .select({
        id: printOrders.id,
        status: printOrders.status,
        material: printOrders.material,
        vendor: printOrders.vendor,
        vendorName: printOrders.vendorName,
        totalPrice: printOrders.totalPrice,
        serviceFee: printOrders.serviceFee,
        fileAssetId: printOrders.fileAssetId,
        fileName: files.name,
      })
      .from(printOrders)
      .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(
        and(
          eq(printOrders.userId, userId),
          inArray(printOrders.status, [...IN_PROGRESS_STATUSES])
        )
      )
      .orderBy(desc(printOrders.createdAt)),
    db
      .select({
        id: printOrders.id,
        status: printOrders.status,
        totalPrice: printOrders.totalPrice,
        serviceFee: printOrders.serviceFee,
        material: printOrders.material,
        vendor: printOrders.vendor,
        vendorName: printOrders.vendorName,
        fileAssetId: printOrders.fileAssetId,
        fileName: files.name,
        createdAt: printOrders.createdAt,
      })
      .from(printOrders)
      .leftJoin(fileAssets, eq(printOrders.fileAssetId, fileAssets.id))
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(
        and(
          eq(printOrders.userId, userId),
          notInArray(printOrders.status, [...IN_PROGRESS_STATUSES])
        )
      )
      .orderBy(desc(printOrders.createdAt))
      .limit(ORDERS_MAX + 1),
  ]);

  const ordersTruncated = ordersRawUncapped.length > ORDERS_MAX;
  const ordersRaw = ordersTruncated
    ? ordersRawUncapped.slice(0, ORDERS_MAX)
    : ordersRawUncapped;

  // Multi-item drafts/orders have fileAssetId=null on the printOrders
  // row — the real files live in printOrderItems. Pull the first item
  // per order (by createdAt asc) so the card can show its filename
  // instead of the "3D Print" fallback, plus a count for the extras.
  // Drafts and orders backfill identical shapes; fan their two
  // inArray lookups out in parallel.
  const multiItemIds = draftsRaw
    .filter((d) => !d.fileAssetId)
    .map((d) => d.id);
  const multiItemOrderIds = ordersRaw
    .filter((o) => !o.fileAssetId)
    .map((o) => o.id);

  const [multiItemMeta, multiItemOrderMeta] = await Promise.all([
    multiItemIds.length
      ? db
          .select({
            printOrderId: printOrderItems.printOrderId,
            materialConfigId: printOrderItems.materialConfigId,
            fileName: files.name,
            originalFilename: fileAssets.originalFilename,
            createdAt: printOrderItems.createdAt,
          })
          .from(printOrderItems)
          .innerJoin(
            fileAssets,
            eq(printOrderItems.fileAssetId, fileAssets.id)
          )
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(inArray(printOrderItems.printOrderId, multiItemIds))
          .orderBy(asc(printOrderItems.createdAt))
      : Promise.resolve([]),
    multiItemOrderIds.length
      ? db
          .select({
            printOrderId: printOrderItems.printOrderId,
            materialConfigId: printOrderItems.materialConfigId,
            fileName: files.name,
            originalFilename: fileAssets.originalFilename,
            createdAt: printOrderItems.createdAt,
          })
          .from(printOrderItems)
          .innerJoin(
            fileAssets,
            eq(printOrderItems.fileAssetId, fileAssets.id)
          )
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(inArray(printOrderItems.printOrderId, multiItemOrderIds))
          .orderBy(asc(printOrderItems.createdAt))
      : Promise.resolve([]),
  ]);

  // Group by printOrderId: { firstName, count, firstMaterial }
  const multiItemByOrder = new Map<
    string,
    {
      firstName: string | null;
      count: number;
      firstMaterial: string | null;
    }
  >();
  for (const item of multiItemMeta) {
    const existing = multiItemByOrder.get(item.printOrderId);
    if (existing) {
      existing.count += 1;
    } else {
      multiItemByOrder.set(item.printOrderId, {
        firstName:
          item.fileName ??
          item.originalFilename?.replace(/\.[^.]+$/, "") ??
          null,
        count: 1,
        firstMaterial: item.materialConfigId,
      });
    }
  }

  const drafts = draftsRaw.map((d) => {
    if (d.fileAssetId) return d; // legacy single-item
    const meta = multiItemByOrder.get(d.id);
    if (!meta) return d;
    return {
      ...d,
      // Show the first item's filename, with "+N" suffix when the
      // cart has additional items from the same vendor.
      fileName:
        meta.count > 1
          ? `${meta.firstName ?? "3D Print"} + ${meta.count - 1} more`
          : meta.firstName,
      // Multi-item orders don't store a single material on the
      // parent row. Fall back to the first item's config so the
      // card shows a material chip instead of blank.
      material: d.material ?? meta.firstMaterial,
    };
  });

  // ordersRaw + multiItemOrderMeta resolved alongside drafts above.
  const multiItemByOrderId = new Map<
    string,
    { firstName: string | null; count: number; firstMaterial: string | null }
  >();
  for (const item of multiItemOrderMeta) {
    const existing = multiItemByOrderId.get(item.printOrderId);
    if (existing) {
      existing.count += 1;
    } else {
      multiItemByOrderId.set(item.printOrderId, {
        firstName:
          item.fileName ??
          item.originalFilename?.replace(/\.[^.]+$/, "") ??
          null,
        count: 1,
        firstMaterial: item.materialConfigId,
      });
    }
  }

  const orders = ordersRaw.map((o) => {
    if (o.fileAssetId) return o;
    const meta = multiItemByOrderId.get(o.id);
    if (!meta) return o;
    return {
      ...o,
      fileName:
        meta.count > 1
          ? `${meta.firstName ?? "3D Print"} + ${meta.count - 1} more`
          : meta.firstName,
      material: o.material ?? meta.firstMaterial,
    };
  });

  if (orders.length === 0 && drafts.length === 0) {
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
    <div className="space-y-6">
      {drafts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Carts</h3>
            <p className="text-xs text-muted-foreground">
              {drafts.length} in progress
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {drafts.map((draft) => {
              const materialMeta = draft.material
                ? getMaterialById(draft.material)
                : null;
              return (
                <DraftCartCard
                  key={draft.id}
                  orderId={draft.id}
                  // Safe narrow: the drafts query filters on
                  // IN_PROGRESS_STATUSES, drizzle just can't carry
                  // that through the row type.
                  status={
                    draft.status as (typeof IN_PROGRESS_STATUSES)[number]
                  }
                  fileAssetId={draft.fileAssetId}
                  fileName={draft.fileName}
                  vendorName={draft.vendorName ?? draft.vendor ?? null}
                  materialId={draft.material}
                  materialName={materialMeta?.name ?? null}
                  materialMethod={materialMeta?.method ?? null}
                  materialColor={materialMeta?.color ?? null}
                  total={draft.totalPrice + draft.serviceFee}
                />
              );
            })}
          </div>
        </section>
      )}

      {orders.length > 0 && (
        <section className="space-y-3">
          {drafts.length > 0 && (
            <h3 className="text-sm font-medium">Orders</h3>
          )}
          {ordersTruncated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Showing your most recent {ORDERS_MAX} orders. Older orders
              aren&apos;t shown here yet — reach out if you need a full
              export.
            </div>
          )}
          {/* flex+gap (not space-y): each row is a Link, and space-y's
              margin-top does not land on a default-inline <a>, so cards
              sat flush. SettingsLink uses the same block Link pattern. */}
          <div className="flex flex-col gap-2">
            {orders.map((order) => {
              const materialMeta = order.material
                ? getMaterialById(order.material)
                : null;
              const orderNumber = formatOrderNumber(order.id);
              const statusLabel = STATUS_LABELS[order.status] || order.status;
              const variant = STATUS_VARIANT[order.status] || "outline";

              return (
                <Link
                  key={order.id}
                  href={`/dashboard/orders/${order.id}`}
                  className="block"
                >
                  {/* py-0: Card defaults to py-4; CardContent already
                      pads the row, so the default doubled the height. */}
                  <Card className="py-0 transition-colors hover:border-primary/30">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        {materialMeta && (
                          <div
                            className="h-8 w-8 shrink-0 rounded-md border border-border"
                            style={{
                              background: `linear-gradient(135deg, ${materialMeta.color}, ${materialMeta.color}dd)`,
                            }}
                          />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {order.fileName ||
                              materialMeta?.name ||
                              order.material ||
                              "3D Print"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {orderNumber}
                            {order.vendorName || order.vendor
                              ? ` · ${order.vendorName ?? order.vendor}`
                              : ""}
                            {materialMeta ? ` · ${materialMeta.method}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={variant}>{statusLabel}</Badge>
                        <p className="w-20 text-right text-sm font-medium tabular-nums">
                          $
                          {(
                            (order.totalPrice + order.serviceFee) /
                            100
                          ).toFixed(2)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
