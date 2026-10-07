import Link from "next/link";
import { db } from "@/lib/db";
import {
  printOrders,
  printOrderItems,
  fileAssets,
  files,
} from "@/lib/db/schema";
import { eq, desc, and, inArray, notInArray, asc } from "drizzle-orm";
import { ChevronRight } from "@/components/icons/chevron-right";
import { formatUsd } from "@/components/ui/summary-list";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/page";
import { Print } from "@/components/icons/print";
import { resolveOrderMaterials } from "@/lib/print/order-material";
import { visibleOrdersFilter } from "@/lib/print/order-visibility";
import { formatOrderNumber } from "@/lib/utils/order-number";
import { DraftCartCard } from "./draft-cart-card";
import { MaterialSwatch } from "./material-swatch";

export const STATUS_LABELS: Record<string, string> = {
  quoting: "Quoting",
  awaiting_agent_approval: "Awaiting approval",
  auto_approved: "Approved, placing soon",
  cart_created: "Pending payment",
  awaiting_production_payment: "Awaiting production payment",
  ordered: "Confirmed",
  in_production: "In production",
  shipped: "Shipped",
  received: "Delivered",
  blocked: "Needs attention",
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

/** Status as coloured text (rulebook: status is text, not a panel). */
const STATUS_TONE: Record<(typeof STATUS_VARIANT)[string], string> = {
  default: "text-success",
  secondary: "text-muted-foreground",
  outline: "text-warning",
  destructive: "text-destructive",
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
          visibleOrdersFilter(),
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
          visibleOrdersFilter(),
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

  const materialsById = await resolveOrderMaterials([
    ...drafts.map((d) => d.material),
    ...orders.map((o) => o.material),
  ]);

  if (orders.length === 0 && drafts.length === 0) {
    return (
      <EmptyState
        icon={<Print />}
        title="No print orders yet"
        description="Upload a model or pick one from the marketplace, choose a material, and it ships to your door."
        action={
          <Button render={<Link href="/print" />}>Print a file</Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {drafts.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base leading-6 font-semibold">Carts</h2>
            <p className="text-[13px] text-muted-foreground tabular-nums">
              {drafts.length} in progress
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {drafts.map((draft) => {
              const materialMeta = draft.material
                ? materialsById.get(draft.material) ?? null
                : null;
              return (
                <li key={draft.id}>
                  <DraftCartCard
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
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {orders.length > 0 && (
        <section className="flex flex-col gap-2">
          {drafts.length > 0 && (
            <h2 className="text-base leading-6 font-semibold">Orders</h2>
          )}
          {ordersTruncated && (
            <Alert variant="warning">
              <AlertDescription>
                Showing your most recent {ORDERS_MAX} orders. Older orders
                aren&apos;t shown here yet — reach out if you need a full
                export.
              </AlertDescription>
            </Alert>
          )}
          {/* Rows are flex Links (block-level), so the CON-30 trap —
              space-y margins not landing on inline <a> — can't recur. */}
          <ul className="-mx-3 flex flex-col">
            {orders.map((order) => {
              const materialMeta = order.material
                ? materialsById.get(order.material) ?? null
                : null;
              const orderNumber = formatOrderNumber(order.id);
              const statusLabel = STATUS_LABELS[order.status] || order.status;
              const tone =
                STATUS_TONE[STATUS_VARIANT[order.status] || "outline"];
              const vendor = order.vendorName ?? order.vendor;

              return (
                <li key={order.id}>
                  <Link
                    href={`/dashboard/orders/${order.id}`}
                    className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <MaterialSwatch color={materialMeta?.color ?? null} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-5 font-medium">
                        {order.fileName ||
                          materialMeta?.name ||
                          order.material ||
                          "3D Print"}
                      </p>
                      <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
                        <span className={tone}>{statusLabel}</span>
                        {` · ${orderNumber}`}
                        {vendor ? (
                          <span className="hidden sm:inline">{` · ${vendor}`}</span>
                        ) : null}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium tabular-nums">
                      {formatUsd(order.totalPrice + order.serviceFee)}
                    </p>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-subtle-foreground transition-colors group-hover:text-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
