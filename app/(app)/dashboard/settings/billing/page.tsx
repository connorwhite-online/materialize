import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { getPaymentMethodSummary } from "@/app/actions/billing";
import { PaymentCard } from "@/components/print/payment-card";
import { BillingActions } from "./billing-actions";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const summary = await getPaymentMethodSummary();
  const sp = await searchParams;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Save a card for agent-initiated orders. Orders within a connected
          agent&apos;s spending policy will charge this card automatically;
          everything else will continue to ask you to confirm by email.
        </p>
      </div>

      {sp.status === "success" && !summary && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          Saving your card. This usually takes a few seconds — refresh if it
          doesn&apos;t appear shortly.
        </div>
      )}
      {sp.status === "cancelled" && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Setup was cancelled. Your previous card (if any) is unchanged.
        </div>
      )}

      <div className="rounded-2xl border border-border p-5">
        <div className="text-sm font-medium">Payment method</div>
        <div className="mt-4">
          <PaymentCard
            brand={summary?.brand}
            last4={summary?.last4 ?? null}
            saved={Boolean(summary)}
          />
        </div>
        {summary ? (
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium capitalize text-foreground">
                {summary.brand}
              </span>{" "}
              ending in {summary.last4} · expires{" "}
              {String(summary.expMonth).padStart(2, "0")}/{summary.expYear}
            </p>
            <BillingActions hasCard />
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              No card on file. Agents will continue to need email confirmation
              for every order.
            </p>
            <BillingActions hasCard={false} />
          </div>
        )}
      </div>
    </div>
  );
}
