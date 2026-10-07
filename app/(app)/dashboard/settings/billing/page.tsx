import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { getPaymentMethodSummary } from "@/app/actions/billing";
import { PaymentCard } from "@/components/print/payment-card";
import { BillingActions } from "./billing-actions";
import { ownerSettingsHref } from "@/lib/profile/owner-settings-tabs";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const [summary, sp, user] = await Promise.all([
    getPaymentMethodSummary(),
    searchParams,
    currentUser(),
  ]);
  // Back to the Payments tab this page was opened from, not the
  // Settings tab /dashboard/settings redirects to.
  const backHref = user?.username
    ? ownerSettingsHref(user.username, "payments")
    : "/dashboard/settings";

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: backHref, label: "Payments" }}
        title="Saved card"
        description="Used for one-tap print checkout. Agents can charge it only within the spending limit you set for them; everything else asks you first."
      />

      {sp.status === "success" && !summary && (
        <Alert>
          <AlertDescription>
            Saving your card. This usually takes a few seconds — refresh if it
            doesn&apos;t appear shortly.
          </AlertDescription>
        </Alert>
      )}
      {sp.status === "cancelled" && (
        <Alert>
          <AlertDescription>
            Setup was cancelled. Your previous card (if any) is unchanged.
          </AlertDescription>
        </Alert>
      )}

      {/* The card is the object, so it gets the visual; the actions sit
          beside it at natural width instead of a full-width bar inside
          a page-wide box. */}
      <section className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
        <PaymentCard
          className="mx-0 max-w-[15rem] shrink-0"
          brand={summary?.brand}
          last4={summary?.last4 ?? null}
          saved={Boolean(summary)}
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          {summary ? (
            <>
              <p className="text-base leading-6 font-semibold">
                <span className="capitalize">{summary.brand}</span> ending in{" "}
                <span className="tabular-nums">{summary.last4}</span>
              </p>
              <p className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                Expires {String(summary.expMonth).padStart(2, "0")}/
                {String(summary.expYear).slice(-2)}
              </p>
            </>
          ) : (
            <>
              <p className="text-base leading-6 font-semibold">
                No card on file
              </p>
              <p className="text-[13px] leading-[18px] text-pretty text-muted-foreground">
                Add one to skip card entry at checkout. Stripe stores it; we
                never see the number.
              </p>
            </>
          )}
          <div className="mt-3">
            <BillingActions hasCard={Boolean(summary)} />
          </div>
        </div>
      </section>

      <p className="text-[13px] leading-[18px] text-muted-foreground">
        Spending limits for agents live in{" "}
        <Link
          href="/dashboard/settings/tokens"
          className="text-foreground underline underline-offset-2 hover:no-underline"
        >
          Connected agents
        </Link>
        .
      </p>
    </Page>
  );
}
