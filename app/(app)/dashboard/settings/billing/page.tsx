import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getPaymentMethodSummary } from "@/app/actions/billing";
import { PaymentCard } from "@/components/print/payment-card";
import { BillingActions } from "./billing-actions";
import { CreditCardIcon } from "@/components/icons/oai";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const summary = await getPaymentMethodSummary();
  const sp = await searchParams;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/dashboard/settings", label: "Settings" }}
        icon={<CreditCardIcon />}
        title="Saved card"
        description="Keep a card on file for print checkout and agent orders. Agents within a spending policy can charge it automatically; everything else still asks you to confirm."
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

      <Card>
        <CardContent className="px-5 py-1">
          <div className="text-sm font-medium">Payment method</div>
          <div className="mt-4">
            <PaymentCard
              brand={summary?.brand}
              last4={summary?.last4 ?? null}
              saved={Boolean(summary)}
            />
          </div>
          {summary ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium capitalize text-foreground">
                  {summary.brand}
                </span>{" "}
                ending in {summary.last4}
              </p>
              <BillingActions hasCard />
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                No card on file. You can add one here for one-tap checkout and
                agent auto-charge.
              </p>
              <BillingActions hasCard={false} />
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
