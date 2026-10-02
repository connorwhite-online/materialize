import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Inline warning shown to a listing's OWNER when their listing has
 * a price but they haven't finished payout onboarding yet. The
 * Purchase button still works (it surfaces "this creator hasn't
 * enabled payouts" to the buyer), but warning the creator at the
 * point they're most likely to notice — viewing their own listing
 * — is friendlier than letting them discover it via a buyer's
 * failed checkout.
 */
export function PayoutSetupWarning() {
  return (
    <Alert variant="warning">
      <AlertTitle>Payouts not set up</AlertTitle>
      <AlertDescription>
        Buyers can&apos;t complete checkout for this paid listing until you
        connect a Stripe account.{" "}
        <Link
          href="/dashboard/settings/payouts"
          className="font-medium whitespace-nowrap"
        >
          Set up payouts
        </Link>
      </AlertDescription>
    </Alert>
  );
}
