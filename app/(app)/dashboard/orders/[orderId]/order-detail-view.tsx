import Link from "next/link";
import { OrderStatusTracker } from "@/components/print/order-status-tracker";
import { OrderModelPreview } from "@/components/print/order-model-preview";
import type { PreviewView } from "@/components/viewer/preview-camera";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import {
  SummaryCard,
  SummaryRow,
  formatUsd,
} from "@/components/ui/summary-list";
import { cn } from "@/lib/utils";

/**
 * Status copy for the order detail header. Keys every
 * printOrderStatusEnum value (AGENTS.md § Print order status machine,
 * consumer checklist). Duplicates components/profile/orders-tab's map
 * until MTR-163 hoists both into one module.
 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
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

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "blocked" || status === "cancelled") return "destructive";
  if (status === "shipped" || status === "received") return "default";
  return "secondary";
}

export interface OrderDetailViewProps {
  order: {
    id: string;
    status: string;
    orderNumber: string;
    createdAt: Date;
    /** Cents. Excludes the service fee. */
    totalPrice: number;
    /** Cents. */
    serviceFee: number;
    trackingInfo?: {
      trackingUrl?: string;
      trackingNumber?: string;
      carrier?: string;
    } | null;
  };
  title: string;
  vendorName: string | null;
  material: { name: string; method?: string; color?: string } | null;
  quantityLabel: string | null;
  /** Cents; 0 when the row predates the split columns. */
  breakdown: { material: number; productionFee: number; shipping: number };
  preview: {
    fileAssetId: string;
    format: "stl" | "obj" | "3mf" | "step" | "amf";
    color: string;
    initialView: PreviewView | null;
    extraItemCount: number;
  } | null;
  payment?: string;
}

/**
 * Order detail, laid out like every primary-object page: the object
 * (the part) on the left, the decision column — what's happening,
 * what it cost, what to do next — sticky on the right. Phones stack.
 */
export function OrderDetailView({
  order,
  title,
  vendorName,
  material,
  quantityLabel,
  breakdown,
  preview,
  payment,
}: OrderDetailViewProps) {
  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
  const orderedOn = order.createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const legacyTotals = breakdown.material === 0 && breakdown.shipping === 0;

  return (
    <Page className="max-w-5xl gap-6">
      {payment === "success" && (
        <Alert variant="success">
          <AlertTitle>Payment confirmed</AlertTitle>
          <AlertDescription>
            Your print has been sent to production. We&apos;ll email you as it
            moves along.
          </AlertDescription>
        </Alert>
      )}
      {payment === "cancelled" && (
        <Alert>
          <AlertTitle>Payment cancelled</AlertTitle>
          <AlertDescription>
            No charges were made. You can retry from your orders page.
          </AlertDescription>
        </Alert>
      )}

      <PageHeader
        back={{ href: "/dashboard/orders", label: "Orders" }}
        eyebrow={`Order ${order.orderNumber}`}
        title={title}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant={statusVariant(order.status)}>{statusLabel}</Badge>
            {[vendorName, material?.name, material?.method]
              .filter(Boolean)
              .join(" · ")}
          </span>
        }
      />

      {/* Two-step checkout limbo: the fee is held and the CraftCloud
          order is placed, but production + shipping haven't been
          paid yet. The tracker renders all-pending for this status,
          so this is the one thing on the page that matters. */}
      {order.status === "awaiting_production_payment" && (
        <Alert variant="warning">
          <AlertTitle>Finish paying for production</AlertTitle>
          <AlertDescription>
            Your service fee is held, not charged. Pay CraftCloud for
            production and shipping to start your print.
          </AlertDescription>
          <Button
            size="sm"
            className="mt-3 w-fit"
            render={<Link href={`/orders/${order.id}/pay-production`} />}
          >
            Complete payment
          </Button>
        </Alert>
      )}

      <div
        className={cn(
          "grid items-start gap-6",
          preview
            ? "lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8"
            : "max-w-xl"
        )}
      >
        {preview ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted">
            <OrderModelPreview
              fileAssetId={preview.fileAssetId}
              format={preview.format}
              materialColor={preview.color}
              initialView={preview.initialView}
            />
            {preview.extraItemCount > 0 && (
              <span className="absolute top-3 right-3 rounded-full bg-background px-2.5 py-1 text-xs font-medium ring-1 ring-border">
                +{preview.extraItemCount} more{" "}
                {preview.extraItemCount === 1 ? "item" : "items"}
              </span>
            )}
          </div>
        ) : null}

        <div className={cn("flex flex-col gap-6", preview && "lg:sticky lg:top-20")}>

          <Card className="gap-0 px-5 pt-4 pb-5">
            <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Status
            </h2>
            <OrderStatusTracker
              orderId={order.id}
              currentStatus={order.status}
              trackingInfo={order.trackingInfo}
            />
          </Card>

          <SummaryCard title="Receipt">
            {legacyTotals ? (
              // Legacy rows without the split subtotal columns — just the
              // lumped production total.
              <SummaryRow label="Production" value={formatUsd(order.totalPrice)} />
            ) : (
              <>
                {breakdown.material > 0 && (
                  <SummaryRow
                    label={`Material${quantityLabel ? ` ${quantityLabel}` : ""}`}
                    value={formatUsd(breakdown.material)}
                  />
                )}
                {breakdown.productionFee > 0 && (
                  <SummaryRow
                    label="Vendor minimum"
                    value={formatUsd(breakdown.productionFee)}
                  />
                )}
                {breakdown.shipping > 0 && (
                  <SummaryRow label="Shipping" value={formatUsd(breakdown.shipping)} />
                )}
              </>
            )}
            <SummaryRow label="Service fee" value={formatUsd(order.serviceFee)} />
            <SummaryRow
              total
              label="Total"
              value={formatUsd(order.totalPrice + order.serviceFee)}
            />
          </SummaryCard>

          <SummaryCard title="Details">
            <SummaryRow label="Ordered" value={orderedOn} />
            {vendorName && <SummaryRow label="Print shop" value={vendorName} />}
            {material && (
              <SummaryRow
                label="Material"
                value={
                  <span className="inline-flex items-center gap-2">
                    {material.color && (
                      <span
                        aria-hidden="true"
                        className="size-3 rounded-full ring-1 ring-border"
                        style={{ background: material.color }}
                      />
                    )}
                    {material.name}
                  </span>
                }
              />
            )}
            <SummaryRow
              label="Order number"
              value={<span className="font-mono text-[13px]">{order.orderNumber}</span>}
            />
          </SummaryCard>
        </div>
      </div>
    </Page>
  );
}
