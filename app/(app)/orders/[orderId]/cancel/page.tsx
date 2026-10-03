import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { CancelOrderForm } from "./cancel-form";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import {
  SummaryCard,
  SummaryRow,
  formatUsd,
} from "@/components/ui/summary-list";
import { RobotIcon } from "@/components/icons/oai";

interface PageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function CancelAgentOrderPage({
  params,
  searchParams,
}: PageProps) {
  const { orderId } = await params;
  const { token } = await searchParams;
  if (!token) notFound();

  const { userId } = await auth();
  if (!userId) {
    const next = encodeURIComponent(`/orders/${orderId}/cancel?token=${token}`);
    redirect(`/sign-in?redirect_url=${next}`);
  }

  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);

  if (!order) notFound();
  if (order.userId !== userId) notFound();
  if (order.confirmationToken !== token) notFound();

  // Three states: still cancellable, already cancelled, window passed.
  const inWindow =
    order.status === "auto_approved" &&
    order.autoApprovedUntil &&
    order.autoApprovedUntil.getTime() > Date.now();
  const alreadyCancelled = order.status === "cancelled";

  const [materialEntry, providerEntry, fileRow] = await Promise.all([
    order.material
      ? findMaterialConfig(order.material).catch(() => null)
      : null,
    order.vendor && !order.vendorName
      ? findProvider(order.vendor).catch(() => null)
      : null,
    order.fileAssetId
      ? db
          .select({
            name: files.name,
            originalFilename: fileAssets.originalFilename,
          })
          .from(fileAssets)
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(eq(fileAssets.id, order.fileAssetId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null,
  ]);

  const fileDisplayName =
    fileRow?.name ??
    fileRow?.originalFilename?.replace(/\.[^.]+$/, "") ??
    "Untitled model";
  const vendorName = order.vendorName ?? providerEntry?.name ?? null;
  const materialName = materialEntry?.material.name ?? null;
  const finishName = materialEntry?.finishGroup.name ?? null;
  const color = materialEntry?.config.color ?? null;

  return (
    <Page width="narrow" className="max-w-xl gap-6">
      <PageHeader
        icon={<RobotIcon />}
        eyebrow="Print order · from your agent"
        title={
          alreadyCancelled
            ? "Order cancelled"
            : inWindow
              ? "Cancel this order?"
              : "Cancellation window closed"
        }
        description={
          order.agentName ? (
            <>
              <span className="font-medium text-foreground">
                {order.agentName}
              </span>{" "}
              placed this order on your behalf and your saved card was charged.
              {inWindow && (
                <>
                  {" "}
                  You can cancel and get a full refund until{" "}
                  <span className="font-medium text-foreground">
                    {order.autoApprovedUntil!.toLocaleString()}
                  </span>
                  .
                </>
              )}
              {alreadyCancelled &&
                " The order was cancelled and a refund has been issued."}
              {!inWindow &&
                !alreadyCancelled &&
                " The cancellation window has closed and the order is being placed with the print vendor. Refunds after this point go through your dashboard."}
            </>
          ) : undefined
        }
      />

      <SummaryCard>
        <SummaryRow label="File" value={fileDisplayName} />
        <SummaryRow
          label="Material"
          value={
            materialName
              ? [materialName, color, finishName].filter(Boolean).join(" · ")
              : "(unknown)"
          }
        />
        <SummaryRow label="Vendor" value={vendorName ?? "(unknown)"} />
        <SummaryRow
          label="Quantity"
          value={order.quantity ? String(order.quantity) : "1"}
        />
        <SummaryRow
          total
          label={alreadyCancelled ? "Refunded" : "Charged"}
          value={formatUsd(order.totalPrice + order.serviceFee)}
        />
      </SummaryCard>

      {inWindow ? (
        <CancelOrderForm orderId={orderId} confirmationToken={token} />
      ) : (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          render={<Link href="/dashboard/orders" />}
        >
          Back to your orders
        </Button>
      )}
    </Page>
  );
}
