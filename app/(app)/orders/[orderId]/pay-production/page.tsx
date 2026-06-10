import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";

/**
 * Two-step checkout interstitial (CON-118). The fee Checkout's
 * success_url lands here (`?fee=authorized`): our Stripe session has
 * only AUTHORIZED the 3% service fee (a hold, not a charge), and the
 * customer still owes CraftCloud the production + shipping payment at
 * CraftCloud's hosted Stripe session (`bridgeSessionUrl`). This page
 * explains the split and hands them off to that session.
 */

interface PageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ fee?: string }>;
}

export default async function PayProductionPage({
  params,
  searchParams,
}: PageProps) {
  const { orderId } = await params;
  const { fee } = await searchParams;

  const { userId } = await auth();
  if (!userId) {
    const next = encodeURIComponent(`/orders/${orderId}/pay-production`);
    redirect(`/sign-in?redirect_url=${next}`);
  }

  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);

  if (!order) notFound();
  if (order.userId !== userId) notFound();

  // This page only makes sense for the two-step model.
  if (order.checkoutModel !== "two_step") redirect("/dashboard/orders");

  // Fee not yet authorized — the carts UI owns the resume flow.
  if (order.status === "cart_created") redirect("/dashboard/orders");

  if (order.status === "cancelled") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Print order
          </p>
          <h1 className="mt-1 text-2xl font-bold">This checkout expired</h1>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          The production payment for this order was never completed, so the
          checkout expired and the hold on your card was released — you were
          not charged anything.{" "}
          <Link href="/print" className="underline hover:text-foreground">
            Start a new print
          </Link>
          .
        </div>
      </div>
    );
  }

  if (order.status !== "awaiting_production_payment") {
    // ordered / in_production / shipped / … — production payment
    // already went through; nothing left to do here.
    redirect(`/dashboard/orders?payment=success&orderId=${order.id}`);
  }

  // Defensive: awaiting payment but no bridge session to send them to.
  if (!order.bridgeSessionUrl) redirect("/dashboard/orders");

  // totalPrice already excludes the service fee — createPrintOrder stores
  // material × qty + vendor minimum + shipping there, with serviceFee in
  // its own column (the confirm page totals them as totalPrice + serviceFee).
  const paidToCraftCloud = order.totalPrice;
  const quantity = order.quantity ?? 1;

  return (
    <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Print order
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          One more step — pay for production
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {fee === "authorized" && (
            <>
              <span className="font-medium text-foreground">
                Your service fee is authorized.
              </span>{" "}
            </>
          )}
          The service fee is only a card authorization for now — it becomes a
          charge only after your print order is placed. Production and
          shipping are paid directly to CraftCloud, our manufacturing
          partner, so their charge will appear separately on your statement.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
        {order.materialSubtotal != null && (
          <Row
            label={`Material${quantity > 1 ? ` × ${quantity}` : ""}`}
            value={fmt(order.materialSubtotal * quantity)}
          />
        )}
        {order.shippingSubtotal != null && (
          <Row label="Shipping" value={fmt(order.shippingSubtotal)} />
        )}
        <div className="pt-2 mt-2 border-t border-border">
          <Row label="Paid to CraftCloud" value={fmt(paidToCraftCloud)} bold />
        </div>
        <Row
          label="Service fee (authorized — charged when your order is placed)"
          value={fmt(order.serviceFee)}
        />
      </div>

      <a
        href={order.bridgeSessionUrl}
        className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Continue to CraftCloud payment
      </a>

      <p className="text-xs text-muted-foreground">
        Your order goes into production once CraftCloud confirms the payment.
        You can always come back to this step from{" "}
        <Link
          href="/dashboard/orders"
          className="underline hover:text-foreground"
        >
          your orders
        </Link>
        .
      </p>
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
