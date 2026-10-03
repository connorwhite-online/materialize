import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import {
  getStripePayoutStatus,
  refreshStripePayoutStatus,
} from "@/app/actions/payouts";
import { PayoutActions } from "./payout-actions";
import { PayoutStatusBanner } from "./payout-status-banner";

export default async function PayoutsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const sp = await searchParams;
  // Always pull the live status for connected accounts so we can
  // surface the "Stripe needs more info" banner accurately. Anon
  // and not-yet-connected users skip the round trip — the cached
  // version is a strict subset.
  const cached = await getStripePayoutStatus();
  const status =
    cached.connected || sp.status === "return"
      ? await refreshStripePayoutStatus()
      : cached;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/dashboard/settings", label: "Settings" }}
        title="Payouts"
        description="Connect a Stripe account to receive payouts when someone buys one of your paid files or projects. Materialize takes a 3% service fee; the rest goes to your connected account."
      />

      {sp.status === "refresh" && (
        <Alert>
          <AlertDescription>
            Looks like you left onboarding before finishing. Pick up where you
            left off with the button below.
          </AlertDescription>
        </Alert>
      )}

      <PayoutStatusBanner status={status} />

      <Card>
        <CardContent className="space-y-4 px-5 py-1">
          <div>
            <div className="text-sm font-medium">Status</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {status.onboarded ? (
                <>
                  <span className="font-medium text-foreground">Connected</span>{" "}
                  — your account is ready to receive payouts.
                </>
              ) : status.connected ? (
                <>
                  <span className="font-medium text-foreground">
                    Onboarding incomplete
                  </span>{" "}
                  — finish setup with Stripe to enable selling.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    Not connected
                  </span>{" "}
                  — paid listings are disabled for your account.
                </>
              )}
            </p>
          </div>

          <PayoutActions
            connected={status.connected}
            onboarded={status.onboarded}
          />
        </CardContent>
      </Card>

      {status.onboarded && (
        <p className="text-xs text-muted-foreground">
          Payouts are scheduled by Stripe according to your connected
          account&apos;s payout schedule. View detail and update bank info via
          the Stripe dashboard link above.
        </p>
      )}
    </Page>
  );
}
