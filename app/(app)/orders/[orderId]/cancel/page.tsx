import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { CancelOrderForm } from "./cancel-form";

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
          {alreadyCancelled
            ? "Order cancelled"
            : inWindow
              ? "Cancel this order?"
              : "Cancellation window closed"}
        </h1>
        {order.agentName && (
          <p className="mt-2 text-sm text-muted-foreground">
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
        <div className="pt-2 mt-2 border-t border-border">
          <Row
            label={alreadyCancelled ? "Refunded" : "Charged"}
            value={fmt(order.totalPrice + order.serviceFee)}
            bold
          />
        </div>
      </div>

      {inWindow ? (
        <CancelOrderForm orderId={orderId} confirmationToken={token} />
      ) : (
        <div className="flex justify-center">
          <Link
            href="/dashboard/orders"
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Back to your orders →
          </Link>
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
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
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
