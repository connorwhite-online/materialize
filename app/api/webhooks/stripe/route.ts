import { headers } from "next/headers";
import { db } from "@/lib/db";
import { users, webhookEventsProcessed } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { handlePrintOrderPayment } from "@/lib/stripe/handle-print-order-payment";
import { handleListingPurchase } from "@/lib/stripe/handle-listing-purchase";
import { handleListingRefund } from "@/lib/stripe/handle-listing-refund";
import { logError } from "@/lib/logger";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logError("stripe-webhook", "STRIPE_WEBHOOK_SECRET not configured");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logError("stripe-webhook-verify", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // We place the CraftCloud order (single-checkout model) on two
  // events:
  //   - checkout.session.completed WITH payment_status === "paid"
  //     (card + synchronous rails — the common path).
  //   - checkout.session.async_payment_succeeded (ACH, SEPA, any
  //     delayed rail where "completed" fires before payment
  //     confirms). Stripe's docs call this out explicitly.
  // Both events carry the same session + metadata shape. The
  // handler is idempotent, so if both fire for the same order we
  // only place it once. (Two-step fee sessions are the third shape,
  // handled separately below.)
  const isPaidCheckout =
    event.type === "checkout.session.completed" &&
    (event.data.object as Stripe.Checkout.Session).payment_status === "paid";
  const isAsyncSuccess = event.type === "checkout.session.async_payment_succeeded";
  // Two-step print orders are the exception to the "paid" gate: their
  // fee-only session uses capture_method: "manual", and a completed
  // manual-capture session reports payment_status "unpaid" (funds are
  // authorized, not captured). Gating on "paid" alone would silently
  // drop these. Recognize them by the metadata stamped in
  // createStripeSessionForOrder, regardless of payment_status — the
  // inner handler's two_step branch only records the authorization
  // and is idempotent.
  const isTwoStepFeeAuth =
    event.type === "checkout.session.completed" &&
    (event.data.object as Stripe.Checkout.Session).metadata?.type ===
      "print_order" &&
    (event.data.object as Stripe.Checkout.Session).metadata?.checkoutModel ===
      "two_step";
  // Mode=setup Checkout Sessions don't have payment_status — they
  // complete the SetupIntent and we persist the resulting payment
  // method onto the user. Tagged with metadata.type=billing_setup
  // by createBillingSetupSession so we don't conflate this with
  // print-order checkouts.
  const isBillingSetup =
    event.type === "checkout.session.completed" &&
    (event.data.object as Stripe.Checkout.Session).mode === "setup" &&
    (event.data.object as Stripe.Checkout.Session).metadata?.type ===
      "billing_setup";
  // Connect Express onboarding completion comes through as
  // `account.updated` on the connected account — Stripe flips
  // charges_enabled / payouts_enabled to true once KYC passes.
  // Re-syncing here makes the creator's payouts settings page
  // reflect reality even if they closed the tab before the
  // refresh-on-return query ran.
  const isAccountUpdated = event.type === "account.updated";
  // `charge.refunded` fires for both full and partial refunds; the
  // inner handler gates on the full-refund case and no-ops otherwise.
  // We route every `charge.refunded` here unconditionally so the
  // dedup table records the event id either way.
  const isChargeRefunded = event.type === "charge.refunded";
  const isHandled =
    isPaidCheckout ||
    isAsyncSuccess ||
    isTwoStepFeeAuth ||
    isBillingSetup ||
    isAccountUpdated ||
    isChargeRefunded;

  // Defense-in-depth dedup — the inner handlePrintOrderPayment also
  // claims atomically against the printOrders row, but recording the
  // Stripe event id here lets us no-op duplicate deliveries before
  // any DB or CraftCloud work fires. Only events we actually handle
  // are recorded; the table grows in proportion to real work, not
  // every Stripe event type. We check FIRST and INSERT after success
  // so transient handler failures still get retried by Stripe — the
  // ack on a duplicate happens only if the prior delivery committed.
  if (isHandled) {
    const [existing] = await db
      .select({ id: webhookEventsProcessed.id })
      .from(webhookEventsProcessed)
      .where(eq(webhookEventsProcessed.id, event.id))
      .limit(1);
    if (existing) {
      return Response.json({ received: true, duplicate: true });
    }
  }

  // Three event families flow through this router and each has a
  // different `data.object` shape. The branching below keeps each
  // cast scoped to the branch that uses it instead of one top-level
  // cast — a Checkout.Session cast is correct only for paidCheckout /
  // asyncSuccess / billingSetup; Charge for chargeRefunded; Account
  // for accountUpdated.
  const isSessionEvent =
    isPaidCheckout || isAsyncSuccess || isTwoStepFeeAuth || isBillingSetup;

  if (isSessionEvent) {
    const session = event.data.object as Stripe.Checkout.Session;
    const printOrderId = session.metadata?.printOrderId;

    if (printOrderId && session.metadata?.type === "print_order") {
      try {
        // `payment_intent` is string | object | null on the session —
        // normalize to string | undefined. Two-step orders persist
        // this id (the manual-capture fee hold) for the
        // reconciliation cron to capture; single-mode ignores it.
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        await handlePrintOrderPayment(printOrderId, { paymentIntentId });
      } catch (error) {
        logError("stripe-webhook-handler", error);
        // Return 500 so Stripe retries — the user paid, we MUST place the order
        return Response.json(
          { error: "Failed to process order" },
          { status: 500 }
        );
      }
    }

    if (session.metadata?.type === "listing_purchase") {
      try {
        await handleListingPurchase(session);
      } catch (error) {
        logError("stripe-webhook-listing-purchase", error);
        // 500 so Stripe retries — the buyer paid, we MUST record the
        // purchases row so entitlement checks start returning true.
        return Response.json(
          { error: "Failed to record purchase" },
          { status: 500 }
        );
      }
    }

    if (isBillingSetup) {
      const userId = session.metadata?.userId;
      if (userId) {
        try {
          // The Checkout Session in setup mode produces a SetupIntent
          // whose payment_method is the card the user just saved.
          // Pull the SetupIntent fresh — `setup_intent` on the
          // session is just the id, not the expanded object.
          const setupIntentId =
            typeof session.setup_intent === "string"
              ? session.setup_intent
              : session.setup_intent?.id;
          if (setupIntentId) {
            const stripe = getStripe();
            const setupIntent =
              await stripe.setupIntents.retrieve(setupIntentId);
            const paymentMethodId =
              typeof setupIntent.payment_method === "string"
                ? setupIntent.payment_method
                : setupIntent.payment_method?.id;
            if (paymentMethodId) {
              await db
                .update(users)
                .set({ defaultPaymentMethod: paymentMethodId })
                .where(eq(users.id, userId));
            }
          }
        } catch (error) {
          logError("stripe-webhook-billing-setup", error);
          // Don't 500 — the user already paid nothing, this is just
          // saving a card. Returning 500 makes Stripe retry forever.
          // We log and let the user try again from the dashboard.
        }
      }
    }
  }

  if (isChargeRefunded) {
    const charge = event.data.object as Stripe.Charge;
    try {
      await handleListingRefund(charge);
    } catch (error) {
      logError("stripe-webhook-listing-refund", error);
      // 500 so Stripe retries — entitlement should drop promptly
      // once a refund clears. Note: refunds for non-listing charges
      // (print orders) silently no-op inside the handler; this
      // 500 only fires for genuine DB failures.
      return Response.json(
        { error: "Failed to record refund" },
        { status: 500 }
      );
    }
  }

  if (isAccountUpdated) {
    // Find the user whose stripeAccountId matches and reconcile
    // the cached onboardingComplete flag. We treat
    // charges_enabled as the canonical signal — payouts_enabled
    // sometimes lags by a day while bank verification clears.
    const account = event.data.object as Stripe.Account;
    try {
      // Stripe does NOT guarantee account.updated delivery order, so
      // the `account` object on THIS event may be stale — a delayed
      // delivery carrying charges_enabled=false can arrive after a
      // newer charges_enabled=true and clobber it, which then blocks
      // checkout (app/actions/checkout.ts gates on
      // stripeOnboardingComplete). Re-fetch the account fresh from
      // Stripe so we always persist its current state regardless of
      // which historical event triggered this handler.
      const stripe = getStripe();
      const fresh = await stripe.accounts.retrieve(account.id);
      const onboarded = fresh.charges_enabled === true;
      await db
        .update(users)
        .set({ stripeOnboardingComplete: onboarded })
        .where(eq(users.stripeAccountId, account.id));
    } catch (error) {
      logError("stripe-webhook-account-updated", error);
      // Don't 500 — Stripe will keep retrying account.updated as
      // long as the account state matters, so the worst case is
      // we miss one of many updates. We log and let the next
      // delivery (or refreshStripePayoutStatus call) reconcile.
    }
  }

  if (isHandled) {
    // Mark the event processed only after every handler that fires
    // succeeded (or was correctly no-op'd because metadata didn't
    // match a known shape). ON CONFLICT DO NOTHING absorbs the
    // rare double-insert when two near-simultaneous deliveries
    // both pass the dedup SELECT above.
    try {
      await db
        .insert(webhookEventsProcessed)
        .values({ id: event.id, eventType: event.type })
        .onConflictDoNothing();
    } catch (err) {
      // Don't fail the webhook on dedup-table issues — handler
      // succeeded, the user paid, the order is placed. A missed
      // dedup row at worst means we re-run on the next retry
      // (handler is itself idempotent).
      logError("stripe-webhook-dedup-insert", err);
    }
  }

  return Response.json({ received: true });
}
