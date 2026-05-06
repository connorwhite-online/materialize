import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { ConfirmOrderForm } from "./confirm-form";

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
    const next = encodeURIComponent(`/orders/${orderId}/confirm?token=${token}`);
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
    order.material ? findMaterialConfig(order.material).catch(() => null) : null,
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
    <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Print order — agent-initiated
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          Confirm and pay
        </h1>
        {order.agentName && (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {order.agentName}
            </span>{" "}
            prepared this order on your behalf. Review the details and confirm
            to pay — the order will only be placed after payment.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
        <Row label="File" value={fileDisplayName} />
        <Row
          label="Material"
          value={
            materialName
              ? [materialName, color, finishName].filter(Boolean).join(" · ")
              : "(unknown)"
          }
        />
        <Row label="Vendor" value={vendorName ?? "(unknown)"} />
        <Row
          label="Quantity"
          value={order.quantity ? String(order.quantity) : "1"}
        />
        <Row
          label="Material subtotal"
          value={fmt(
            (order.materialSubtotal ?? 0) * (order.quantity ?? 1)
          )}
        />
        <Row label="Shipping" value={fmt(order.shippingSubtotal ?? 0)} />
        <Row label="Service fee" value={fmt(order.serviceFee)} />
        <div className="pt-2 mt-2 border-t border-border">
          <Row
            label="Total"
            value={fmt(order.totalPrice + order.serviceFee)}
            bold
          />
        </div>
      </div>

      {order.shippingAddress?.shipping && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Ship to
          </div>
          <div className="mt-1.5 leading-relaxed">
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
        </div>
      )}

      {order.status === "awaiting_agent_approval" && !expired ? (
        <>
          {payment === "cancelled" && (
            <p className="text-xs text-muted-foreground">
              Payment was cancelled. You can try again below.
            </p>
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
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
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
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
