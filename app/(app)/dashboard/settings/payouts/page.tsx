import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeft } from "@/components/icons/chevron-left";
import {
  getStripePayoutStatus,
  refreshStripePayoutStatus,
} from "@/app/actions/payouts";
import { PayoutActions } from "./payout-actions";

export default async function PayoutsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const sp = await searchParams;
  // Returning from Stripe-hosted onboarding — refresh proactively so
  // the page reflects the latest charges_enabled / payouts_enabled
  // flags without waiting for the account.updated webhook to land.
  const status =
    sp.status === "return"
      ? await refreshStripePayoutStatus()
      : await getStripePayoutStatus();

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
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a Stripe account to receive payouts when someone buys
          one of your paid files or projects. Materialize takes a 3%
          service fee; the rest goes to your connected account.
        </p>
      </div>

      {sp.status === "refresh" && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          Looks like you left onboarding before finishing. Pick up where
          you left off with the button below.
        </div>
      )}

      <div className="rounded-lg border border-border p-4 space-y-4">
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
      </div>

      {status.onboarded && (
        <p className="text-xs text-muted-foreground">
          Payouts are scheduled by Stripe according to your connected
          account&apos;s payout schedule. View detail and update bank info
          via the Stripe dashboard link above.
        </p>
      )}
    </div>
  );
}
