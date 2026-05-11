interface Status {
  connected: boolean;
  onboarded: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  pendingRequirements: number;
}

/**
 * Contextual banner shown when a connected account is in a non-
 * healthy state. Three cases:
 *
 * 1. `!connected` or onboarded — nothing to show; the page's main
 *    status row already says what's going on.
 * 2. connected + `!detailsSubmitted` — generic "finish onboarding"
 *    nudge. The page already has a "Finish onboarding" button so
 *    we skip the banner here too (would be redundant copy).
 * 3. connected + `detailsSubmitted` + `!chargesEnabled` — Stripe
 *    submitted the form but charges are disabled. This is the
 *    case the user actually wanted a banner for: copy depends on
 *    the disabled_reason Stripe gives us.
 */
export function PayoutStatusBanner({ status }: { status: Status }) {
  if (!status.connected || status.onboarded) return null;
  if (!status.detailsSubmitted) return null;

  const { headline, body } = describe(
    status.disabledReason,
    status.pendingRequirements
  );

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        {headline}
      </p>
      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
        {body}
      </p>
      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
        Open the Stripe dashboard below to{" "}
        {status.pendingRequirements > 0
          ? "submit the missing information"
          : "review the account"}
        .
      </p>
    </div>
  );
}

/**
 * Map Stripe's `requirements.disabled_reason` to a human-readable
 * headline + body. The set of values isn't fully closed (Stripe
 * adds new reasons over time) so we fall through to a generic
 * "Stripe disabled charges" message.
 *
 * Reference: https://stripe.com/docs/api/accounts/object#account_object-requirements-disabled_reason
 */
function describe(
  reason: string | null,
  pending: number
): { headline: string; body: string } {
  if (reason === "requirements.past_due") {
    return {
      headline: "Stripe is waiting on required info",
      body: `${pending || "Some"} item${pending === 1 ? "" : "s"} from your onboarding form ${
        pending === 1 ? "is" : "are"
      } past due. Charges are paused until it's submitted.`,
    };
  }
  if (
    reason === "requirements.pending_verification" ||
    reason === "under_review"
  ) {
    return {
      headline: "Stripe is verifying your account",
      body: "Verification usually takes a few minutes to a few hours. Charges will re-enable automatically once the review completes.",
    };
  }
  if (reason === "listed") {
    return {
      headline: "Stripe flagged your account",
      body: "Your account is under Stripe review. You'll need to contact Stripe Support to resolve.",
    };
  }
  if (reason?.startsWith("rejected.")) {
    return {
      headline: "Stripe rejected your account",
      body: "Stripe declined to enable charges for this account. You'll need to reach out to Stripe Support to dispute or reconnect with a new account.",
    };
  }
  if (reason === "platform_paused") {
    return {
      headline: "Account paused",
      body: "Materialize has paused this account. Reach out via the contact link in the footer.",
    };
  }
  return {
    headline: "Stripe disabled charges on your account",
    body: pending
      ? `${pending} outstanding requirement${pending === 1 ? "" : "s"} — open the Stripe dashboard to clear it.`
      : "Open the Stripe dashboard below to see what's needed.",
  };
}

