import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/db/schema";
import { verifyPayProductionToken } from "@/lib/orders/pay-production-token";

/**
 * Two-step checkout interstitial (CON-118). The fee Checkout's
 * success_url lands here (`?fee=authorized`): our Stripe session has
 * only AUTHORIZED the 3% service fee (a hold, not a charge), and the
 * customer still owes CraftCloud the production + shipping payment at
 * CraftCloud's hosted Stripe session (`bridgeSessionUrl`). This page
 * explains the split and hands them off to that session.
 *
 * Two ways in, because Stripe's redirect can land in a browser context
 * with no Clerk session (iOS PWA in-app overlay — isolated cookie jar):
 *
 *   1. Signed link token (`?t=`, minted into the success_url) — proves
 *      the visitor holds this order's own checkout link. Renders with
 *      no session. The token does NOT prove payment (it's minted at
 *      session creation), so payment-dependent branches still key off
 *      the order STATUS, and a tokened visitor whose webhook hasn't
 *      landed yet gets a self-refreshing waiting state — never a
 *      redirect into a protected page they can't load.
 *   2. Signed-in owner — the normal path (dashboard links, resume).
 *
 * The route is public at the middleware layer (see proxy.ts); this
 * page IS the gate.
 */

interface PageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ fee?: string; t?: string }>;
}

export default async function PayProductionPage({
  params,
  searchParams,
}: PageProps) {
  const { orderId } = await params;
  const { fee, t } = await searchParams;

  const hasLinkToken = verifyPayProductionToken(orderId, t);

  if (!hasLinkToken) {
    const { userId } = await auth();
    if (!userId) {
      const next = encodeURIComponent(`/orders/${orderId}/pay-production`);
      redirect(`/sign-in?redirect_url=${next}`);
    }

    const [owned] = await db
      .select({ userId: printOrders.userId })
      .from(printOrders)
      .where(eq(printOrders.id, orderId))
      .limit(1);
    if (!owned) notFound();
    if (owned.userId !== userId) notFound();
  }

  const [order] = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.id, orderId))
    .limit(1);

  if (!order) notFound();

  // This page only makes sense for the two-step model.
  if (order.checkoutModel !== "two_step") {
    if (hasLinkToken) notFound();
    redirect("/dashboard/orders");
  }

  // Fee not yet recorded. For a signed-in visitor the carts UI owns
  // the resume flow. For a tokened visitor this is almost always the
  // Stripe-redirect-vs-webhook race (they JUST paid); show a waiting
  // state that reloads itself instead of bouncing them to a protected
  // page their session-less context can't open.
  if (order.status === "cart_created") {
    if (hasLinkToken) {
      return (
        <WaitingCard
          title="Confirming your payment…"
          body="Your service fee authorization is being recorded. This
            usually takes a few seconds — this page will refresh on its
            own."
          reload
        />
      );
    }
    redirect("/dashboard/orders");
  }

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
    if (hasLinkToken) {
      return (
        <WaitingCard
          title="You're all set"
          body="Production payment is complete and your order has been
            placed. You can follow its progress from your orders page."
        />
      );
    }
    redirect(`/dashboard/orders?payment=success&orderId=${order.id}`);
  }

  // Defensive: awaiting payment but no bridge session to send them to.
  if (!order.bridgeSessionUrl) {
    if (hasLinkToken) {
      return (
        <WaitingCard
          title="Almost there"
          body="We couldn't find the production payment link for this
            order. Open your orders page and use the Complete payment
            button there."
        />
      );
    }
    redirect("/dashboard/orders");
  }

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

/**
 * Terminal/waiting states for tokened (session-less) visitors. Never
 * links into /dashboard directly as the primary action — that's a
 * protected route the visitor's context may not be able to open; the
 * copy points them back at the app instead.
 */
function WaitingCard({
  title,
  body,
  reload,
}: {
  title: string;
  body: string;
  reload?: boolean;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
      {reload && (
        <script
          // Plain reload loop — the page is a server component, so a
          // meta-refresh-style reload keeps the waiting state simple
          // and JS-light. Stops mattering the moment the webhook
          // advances the order and the reload renders the real step.
          dangerouslySetInnerHTML={{
            __html: "setTimeout(function(){location.reload()},4000);",
          }}
        />
      )}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Print order
        </p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      </div>
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        {body}
      </div>
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
