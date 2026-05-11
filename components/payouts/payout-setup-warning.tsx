import Link from "next/link";

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
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        Payouts not set up
      </p>
      <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/80">
        Buyers can&apos;t complete checkout for this paid listing until
        you connect a Stripe account.
      </p>
      <Link
        href="/dashboard/settings/payouts"
        className="mt-1 inline-block font-medium underline-offset-2 hover:underline text-amber-900 dark:text-amber-100"
      >
        Set up payouts →
      </Link>
    </div>
  );
}
