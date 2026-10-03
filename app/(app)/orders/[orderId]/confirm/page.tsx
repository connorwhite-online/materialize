import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { ConfirmOrderForm } from "./confirm-form";
import { Page, PageHeader } from "@/components/ui/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  SummaryCard,
  SummaryRow,
  formatUsd,
} from "@/components/ui/summary-list";
import { RobotIcon } from "@/components/icons/oai";

interface PageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string; payment?: string }>;
}

export default async function ConfirmAgentOrderPage({
  params,
  searchParams,
}: PageProps) {
  const { orderId } = await params;
  const { token, payment } = await searchParams;
  if (!token) notFound();

  const { userId } = await auth();
  if (!userId) {
    const next = encodeURIComponent(
      `/orders/${orderId}/confirm?token=${token}`
    );
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

  const expired =
    order.confirmationExpiresAt &&
    order.confirmationExpiresAt.getTime() < Date.now();

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
        title="Confirm and pay"
        description={
          order.agentName ? (
            <>
              <span className="font-medium text-foreground">
                {order.agentName}
              </span>{" "}
              prepared this order on your behalf. Review the details and confirm
              to pay — the order will only be placed after payment.
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
          label="Material subtotal"
          value={formatUsd(
            (order.materialSubtotal ?? 0) * (order.quantity ?? 1)
          )}
        />
        <SummaryRow
          label="Shipping"
          value={formatUsd(order.shippingSubtotal ?? 0)}
        />
        <SummaryRow label="Service fee" value={formatUsd(order.serviceFee)} />
        <SummaryRow
          total
          label="Total"
          value={formatUsd(order.totalPrice + order.serviceFee)}
        />
      </SummaryCard>

      {order.shippingAddress?.shipping && (
        <SummaryCard title="Ship to">
          <div className="leading-relaxed">
            {order.shippingAddress.shipping.firstName}{" "}
            {order.shippingAddress.shipping.lastName}
            <br />
            {order.shippingAddress.shipping.address}
            {order.shippingAddress.shipping.addressLine2 ? (
              <>
                <br />
                {order.shippingAddress.shipping.addressLine2}
              </>
            ) : null}
            <br />
            {order.shippingAddress.shipping.city},{" "}
            {order.shippingAddress.shipping.stateCode}{" "}
            {order.shippingAddress.shipping.zipCode}
            <br />
            {order.shippingAddress.shipping.countryCode}
          </div>
        </SummaryCard>
      )}

      {order.status === "awaiting_agent_approval" && !expired ? (
        <>
          {payment === "cancelled" && (
            <Alert>
              <AlertDescription>
                Payment was cancelled. You can try again below.
              </AlertDescription>
            </Alert>
          )}
          <ConfirmOrderForm orderId={order.id} confirmationToken={token} />
          <p className="text-xs text-muted-foreground">
            Don&apos;t recognize this? You can{" "}
            <Link
              href="/dashboard/settings/tokens"
              className="underline hover:text-foreground"
            >
              revoke the agent&apos;s access
            </Link>
            .
          </p>
        </>
      ) : (
        <Alert>
          <AlertDescription>
            {expired ? (
              <>
                This confirmation link has expired. Ask the agent to create a
                fresh order.
              </>
            ) : order.status === "cart_created" ? (
              <>
                This order is awaiting payment.{" "}
                <Link
                  href={`/dashboard/orders`}
                  className="underline hover:text-foreground"
                >
                  View in your orders
                </Link>
                .
              </>
            ) : (
              <>
                This order is no longer awaiting approval (status:{" "}
                <code className="font-mono text-xs">{order.status}</code>).
                <Link
                  href={`/dashboard/orders/${order.id}`}
                  className="ml-2 underline hover:text-foreground"
                >
                  View order
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </Page>
  );
}
