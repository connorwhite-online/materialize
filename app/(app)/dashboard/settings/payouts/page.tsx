import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LandmarkIcon } from "lucide-react";
import { SettingsGroup, SettingsRow } from "@/components/ui/field";
import { ownerSettingsHref } from "@/lib/profile/owner-settings-tabs";
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

  const [sp, user] = await Promise.all([searchParams, currentUser()]);
  const backHref = user?.username
    ? ownerSettingsHref(user.username, "payments")
    : "/dashboard/settings";
  // Always pull the live status for connected accounts so we can
  // surface the "Stripe needs more info" banner accurately. Anon
  // and not-yet-connected users skip the round trip — the cached
  // version is a strict subset.
  const cached = await getStripePayoutStatus();
  const status =
    cached.connected || sp.status === "return"
      ? await refreshStripePayoutStatus()
      : cached;

  const state = status.onboarded
    ? {
        title: "Connected",
        body: "Your Stripe account is ready to receive payouts.",
        tone: "text-success",
      }
    : status.connected
      ? {
          title: "Onboarding incomplete",
          body: "Finish setup with Stripe to start selling paid listings.",
          tone: "text-warning",
        }
      : {
          title: "Not connected",
          body: "Paid listings stay off until you connect a Stripe account.",
          tone: "text-muted-foreground",
        };

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: backHref, label: "Payments" }}
        title="Payouts"
        description="Get paid when someone buys one of your files or projects."
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

      <section className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
          >
            <LandmarkIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm leading-5 font-medium">Stripe account</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-pretty">
              <span className={`font-medium ${state.tone}`}>{state.title}</span>
              <span className="text-muted-foreground"> · {state.body}</span>
            </p>
          </div>
        </div>
        <div className="sm:pl-[52px]">
          <PayoutActions
            connected={status.connected}
            onboarded={status.onboarded}
          />
        </div>
      </section>

      <SettingsGroup title="How payouts work">
        <SettingsRow
          title="Service fee"
          description="Materialize keeps 3% of each sale; the rest goes to your Stripe account."
          control={<span className="text-sm tabular-nums">3%</span>}
        />
        <SettingsRow
          title="Schedule"
          description="Stripe pays out on your connected account's schedule. Bank details live in the Stripe dashboard."
        />
      </SettingsGroup>
    </Page>
  );
}
