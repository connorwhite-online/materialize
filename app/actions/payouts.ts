"use server";

/**
 * Stripe Connect Express onboarding for creators who want to sell
 * paid files / projects on Materialize.
 *
 * Flow (creator's perspective):
 *   1. /dashboard/settings/payouts → "Set up payouts"
 *   2. createStripeConnectAccount() — first-time only, creates the
 *      Express account and stashes the id on users.stripeAccountId
 *   3. createStripePayoutOnboardingLink() — Stripe issues a one-time
 *      onboarding URL we redirect to
 *   4. Stripe-hosted onboarding (KYC, bank info)
 *   5. Stripe redirects back to /dashboard/settings/payouts which
 *      calls refreshStripePayoutStatus() to read the latest
 *      charges_enabled / payouts_enabled flags
 *
 * Once `stripeOnboardingComplete` flips true, paid listings can
 * point checkout sessions at this user's connected account via
 * `transfer_data.destination`, taking a 3% application_fee_amount
 * for the platform.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type StatusResult = {
  connected: boolean;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /**
   * True once the creator has finished the Stripe-hosted onboarding
   * form. Distinguishes "never started onboarding" from "submitted but
   * Stripe needs more info" — both have `onboarded === false` but the
   * UX is different.
   */
  detailsSubmitted: boolean;
  /**
   * Stripe's machine-readable reason charges are off, when applicable.
   * Common values: `requirements.past_due`, `requirements.pending_verification`,
   * `rejected.fraud`, `rejected.terms_of_service`, `listed`, `under_review`.
   * Null when the account is healthy or when we don't have an account
   * record yet.
   */
  disabledReason: string | null;
  /**
   * Count of outstanding `requirements.currently_due` items — when
   * positive, the creator needs to revisit Stripe's hosted onboarding
   * to clear them.
   */
  pendingRequirements: number;
};

const EMPTY_STATUS: StatusResult = {
  connected: false,
  onboarded: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  disabledReason: null,
  pendingRequirements: 0,
};

/**
 * Read-only view of the user's payout status. Returns the cached
 * `stripeOnboardingComplete` flag plus the boolean for whether
 * the account record exists at all. Use this for rendering the
 * settings page; refreshStripePayoutStatus() is the version that
 * also re-syncs from Stripe.
 */
export async function getStripePayoutStatus(): Promise<StatusResult> {
  const { userId } = await auth();
  if (!userId) return EMPTY_STATUS;
  const [row] = await db
    .select({
      stripeAccountId: users.stripeAccountId,
      onboardingComplete: users.stripeOnboardingComplete,
    })
    .from(users)
    .where(eq(users.id, userId));
  const connected = !!row?.stripeAccountId;
  const onboarded = !!row?.onboardingComplete;
  return {
    connected,
    onboarded,
    // Without a fresh Stripe lookup we can't tell whether charges /
    // payouts are individually enabled; treat the cached
    // onboardingComplete as a proxy. refreshStripePayoutStatus
    // re-syncs both flags from Stripe directly.
    chargesEnabled: onboarded,
    payoutsEnabled: onboarded,
    // Same proxy logic for detailsSubmitted: we don't store it, so
    // assume onboarded ⇒ details submitted. The refresh call pulls
    // the live value when accuracy matters (i.e. when we're about
    // to show a "needs more info" banner).
    detailsSubmitted: onboarded,
    disabledReason: null,
    pendingRequirements: 0,
  };
}

/**
 * Create the Express account if it doesn't exist yet, then mint a
 * fresh onboarding link. Idempotent in the sense that calling it
 * twice with an already-saved accountId just re-issues the link.
 */
export async function createStripePayoutOnboardingLink(): Promise<
  { url: string } | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const stripe = getStripe();

    const [user] = await db
      .select({
        stripeAccountId: users.stripeAccountId,
        displayName: users.displayName,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return { error: "User not found" };

    let accountId = user.stripeAccountId;
    if (!accountId) {
      // Express accounts give Stripe's own hosted onboarding +
      // dashboard. Cheaper to support than Custom — Stripe takes
      // KYC / disputes / payouts off our plate entirely.
      const account = await stripe.accounts.create({
        type: "express",
        // capabilities the destination needs to receive funds. Both
        // required when we charge with destination + application_fee.
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        metadata: { userId },
      });
      accountId = account.id;
      await db
        .update(users)
        .set({ stripeAccountId: accountId })
        .where(eq(users.id, userId));
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      // Refresh = user bailed mid-onboarding; bounce back to the same
      // page so they can re-start. Return = onboarding complete; we
      // read the latest status on the return.
      refresh_url: `${APP_URL}/dashboard/settings/payouts?status=refresh`,
      return_url: `${APP_URL}/dashboard/settings/payouts?status=return`,
      type: "account_onboarding",
    });

    return { url: link.url };
  } catch (error) {
    logError("createStripePayoutOnboardingLink", error);
    return { error: "Couldn't start payout onboarding" };
  }
}

/**
 * Pull the live `charges_enabled` / `payouts_enabled` flags from
 * Stripe and reconcile our `stripeOnboardingComplete` column. Called
 * from the settings page on return from Stripe-hosted onboarding so
 * the UI reflects reality without waiting for the account.updated
 * webhook to land.
 */
export async function refreshStripePayoutStatus(): Promise<StatusResult> {
  const { userId } = await auth();
  if (!userId) return EMPTY_STATUS;

  const [user] = await db
    .select({
      stripeAccountId: users.stripeAccountId,
      onboardingComplete: users.stripeOnboardingComplete,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.stripeAccountId) return EMPTY_STATUS;

  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;
    const disabledReason = account.requirements?.disabled_reason ?? null;
    const pendingRequirements =
      account.requirements?.currently_due?.length ?? 0;
    // Treat charges_enabled as the gate for "can sell" since
    // payouts_enabled also requires payouts setup which Stripe
    // sometimes lags on. The webhook listens for the explicit
    // completion event regardless.
    const newOnboarded = chargesEnabled;
    if (newOnboarded !== user.onboardingComplete) {
      await db
        .update(users)
        .set({ stripeOnboardingComplete: newOnboarded })
        .where(eq(users.id, userId));
    }
    return {
      connected: true,
      onboarded: newOnboarded,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      disabledReason,
      pendingRequirements,
    };
  } catch (error) {
    logError("refreshStripePayoutStatus", error);
    const onboarded = !!user.onboardingComplete;
    return {
      connected: true,
      onboarded,
      chargesEnabled: onboarded,
      payoutsEnabled: onboarded,
      detailsSubmitted: onboarded,
      disabledReason: null,
      pendingRequirements: 0,
    };
  }
}

/**
 * Mint a link to the connected account's Stripe Express dashboard.
 * Creators use this to update bank info, view payouts, etc. after
 * onboarding is complete.
 */
export async function createStripePayoutDashboardLink(): Promise<
  { url: string } | { error: string }
> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };
    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.stripeAccountId) return { error: "Not connected" };

    const stripe = getStripe();
    const link = await stripe.accounts.createLoginLink(user.stripeAccountId);
    return { url: link.url };
  } catch (error) {
    logError("createStripePayoutDashboardLink", error);
    return { error: "Couldn't open Stripe dashboard" };
  }
}
