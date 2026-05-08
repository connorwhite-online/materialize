# Deferred — Paid file & project purchases

The `Purchase` buttons on `/files/[slug]` and `/projects/[slug]` are
currently static stubs. The full flow requires more than a button
wire-up; documenting the gap here so we don't ship something half-baked.

## What's missing

1. **Stripe Connect onboarding** — `users.stripeAccountId` and
   `users.stripeOnboardingComplete` columns exist but nothing writes
   to them. Creators can't currently onboard to receive payouts.
   Without this, a paid checkout has nowhere to send the creator's
   cut (the marketplace's whole point).

2. **Connected-account checkout session** — server action that
   creates a Stripe Checkout session with `application_fee_amount`
   for the platform's cut and routes to the creator's connected
   account. Today's `lib/stripe/handle-print-order-payment.ts` is
   print-order-specific and doesn't handle file/project purchases.

3. **Stripe webhook `purchases` row insert** — the current
   `app/api/webhooks/stripe/route.ts` handler only branches on
   sessions with `printOrderId` metadata. A separate path for
   sessions tagged with `fileId` / `projectId` is needed; on
   `checkout.session.completed` it should insert a `purchases`
   row (the table already exists) with `status='completed'`,
   `creatorPayout` calculated from the Stripe `application_fee_amount`,
   and `stripePaymentIntentId` populated.

4. **Buyer-facing wiring** — replace the stub `Purchase` buttons on
   `app/(app)/files/[slug]/page.tsx` and
   `app/(app)/projects/[slug]/page.tsx` with calls to the checkout
   action, then redirect to the Stripe-hosted page. Post-checkout
   success URL probably routes through `/dashboard/orders` to surface
   the completed purchase.

5. **Purchase-on-listing notification** — once `purchases` row inserts
   are real, fire a `purchase_on_listing` notification to the creator.
   `notifyPrintOrderPlaced` is the closest existing template; copy
   the shape into `lib/notifications/purchase.ts` and hook into the
   webhook handler.

## Approximate scope

3–5 days end to end, ideally tackled in 4 staged commits:

- (a) Stripe Connect Express onboarding flow + `/dashboard/settings/payouts`
- (b) Checkout session action + Purchase button wire-up + redirect
- (c) Webhook handler branch + `purchases` row insert
- (d) Purchase notification + earnings tab now surfaces real data

## Why we paused

Tried to wire the Purchase buttons in a single afternoon and realized
(1) was missing — would have required either a half-baked "you owe
the creator" IOU model or a "we'll forward payments manually"
workaround, both of which create real liability rather than just bad
UX. Better to do this as a deliberate project than a tacked-on
follow-on.

## What's already there

- `purchases` table — `id, buyerId, fileId|projectId (xor), amount,
  serviceFee, creatorPayout, stripePaymentIntentId, status` — ready
  to receive rows.
- `lib/entitlement.ts:userOwnsFile` — already checks for completed
  `purchases` rows, so the rest of the app (download routes, file
  detail entitlement) will start respecting paid purchases as soon
  as we're inserting rows.
- Earnings tab (`components/profile/earnings-tab.tsx`) already sums
  `purchases.creatorPayout` and renders it; will show real numbers
  the day the webhook starts inserting rows.
