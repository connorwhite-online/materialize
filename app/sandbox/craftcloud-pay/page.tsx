import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import {
  CreditCardIcon,
  FactoryIcon,
  PackageCheckIcon,
  TimerOffIcon,
} from "lucide-react";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { isMockCheckoutMode } from "@/lib/craftcloud/client";
import { SandboxPayButton } from "./pay-button";

/**
 * Sandbox stand-in for CraftCloud's hosted production-payment page.
 * Mock checkout mode's `createStripeCheckout` mints bridge session
 * URLs that point here, so the two-step flow keeps its real shape —
 * fee sheet → "CraftCloud" payment → back to orders — instead of
 * skipping the production payment entirely and leaving the order at
 * "Complete payment" until the reconcile cron quietly confirms it.
 *
 * Deliberately outside the (app) route group: no Materialize nav, so
 * it reads as "you've left the app", the way the real CraftCloud page
 * would. notFound() outside mock checkout mode — this page must not
 * exist against the live API. The route sits behind the default
 * auth.protect() in proxy.ts, and the order lookup is owner-scoped.
 */

export default async function SandboxCraftCloudPayPage({
  searchParams,
}: {
  searchParams: Promise<{ ccOrderId?: string }>;
}) {
  if (!isMockCheckoutMode()) notFound();

  const { ccOrderId } = await searchParams;
  if (!ccOrderId) notFound();

  const { userId } = await auth();
  if (!userId) notFound();

  const [order] = await db
    .select({
      id: printOrders.id,
      status: printOrders.status,
      totalPrice: printOrders.totalPrice,
      materialSubtotal: printOrders.materialSubtotal,
      shippingSubtotal: printOrders.shippingSubtotal,
      quantity: printOrders.quantity,
      vendorName: printOrders.vendorName,
    })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.craftCloudOrderId, ccOrderId),
        eq(printOrders.userId, userId)
      )
    )
    .limit(1);

  if (!order) notFound();

  const quantity = order.quantity ?? 1;

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400">
            <FactoryIcon className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">
              CraftCloud payment
            </h1>
            <p className="text-xs text-muted-foreground">
              Production &amp; shipping
              {order.vendorName ? ` · ${order.vendorName}` : ""}
            </p>
          </div>
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            Sandbox
          </span>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          This page stands in for CraftCloud&apos;s hosted checkout while
          Materialize runs in mock checkout mode — nothing is charged.
          Paying here marks the production payment complete exactly the way
          a real CraftCloud payment would.
        </p>

        {order.status === "awaiting_production_payment" ? (
          <>
            <div className="mt-5 space-y-2.5 rounded-2xl border border-border/60 p-4 text-sm">
              {order.materialSubtotal != null && (
                <Row
                  label={`Production${quantity > 1 ? ` × ${quantity}` : ""}`}
                  value={fmt(order.materialSubtotal * quantity)}
                />
              )}
              {order.shippingSubtotal != null && (
                <Row label="Shipping" value={fmt(order.shippingSubtotal)} />
              )}
              <div className="border-t border-border pt-2.5">
                <Row label="Total" value={fmt(order.totalPrice)} bold />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                <CreditCardIcon className="h-5 w-5" strokeWidth={2.5} />
              </div>
              <span className="text-[15px] font-medium">
                Test card •••• 4242
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Sandbox
              </span>
            </div>

            <div className="mt-5">
              <SandboxPayButton
                orderId={order.id}
                amountLabel={fmt(order.totalPrice)}
              />
            </div>

            <Link
              href={`/orders/${order.id}/pay-production`}
              className="mt-4 block text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel and go back
            </Link>
          </>
        ) : order.status === "cancelled" ? (
          <StatusCard
            icon={
              <TimerOffIcon className="h-6 w-6" strokeWidth={2.5} />
            }
            tone="bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
            title="This checkout expired"
            body="The production payment was never completed, so the order was cancelled and the service-fee hold released."
            cta={{ href: "/print", label: "Start a new print" }}
          />
        ) : order.status === "cart_created" ? (
          <StatusCard
            icon={
              <CreditCardIcon className="h-6 w-6" strokeWidth={2.5} />
            }
            tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            title="Service fee not authorized yet"
            body="Finish the service-fee step first — resume this order from your orders page."
            cta={{ href: "/dashboard/orders", label: "Go to your orders" }}
          />
        ) : (
          <StatusCard
            icon={
              <PackageCheckIcon className="h-6 w-6" strokeWidth={2.5} />
            }
            tone="bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400"
            title="Already paid"
            body="Production payment is complete and this order has been placed."
            cta={{ href: "/dashboard/orders", label: "Track your order" }}
          />
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  tone,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone}`}
        >
          {icon}
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
      <Link
        href={cta.href}
        className="block w-full rounded-2xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {cta.label}
      </Link>
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
      <span className={`tabular-nums ${bold ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
