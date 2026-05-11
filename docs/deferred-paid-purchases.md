# Paid file & project purchases — what shipped, what's left

The four-phase plan in this doc was shipped in
[commits 0a7fc30 + c24e34e](#):

- **Phase A** — Stripe Connect Express onboarding + payouts settings
  page at `/dashboard/settings/payouts`.
- **Phase B** — `createListingCheckoutSession` server action +
  `<PurchaseButton>` component on file and project detail pages,
  routing funds via `transfer_data.destination` with a 3%
  `application_fee_amount`.
- **Phase C** — Webhook `listing_purchase` branch +
  `handleListingPurchase` that inserts the `purchases` row.
- **Phase D** — `purchase_on_listing` notification through the bell
  inbox, email template, and email-pref opt-out.

The `purchases` table is the entitlement source of truth — the
download routes, file/project detail pages, and earnings tab all
consult it via `userOwnsFile` / `userOwnsProject`, so paid downloads
unlock immediately on checkout completion. Earnings tab also sums
`purchases.creatorPayout`; it'll start showing real numbers the
moment the first paid sale clears.

## Still deferred

These were intentionally not bundled with the v1 ship:

### Refunds

Stripe's `charge.refunded` webhook isn't handled. A refunded
purchase keeps `status='completed'` and the buyer keeps access. The
fix:

1. Listen for `charge.refunded` (or `refund.created`) in the
   webhook router.
2. Look up the `purchases` row by `stripePaymentIntentId`, flip
   `status` to `'refunded'`.
3. The entitlement helpers already filter on `status='completed'`,
   so access drops with no further changes.

Optional but nice: a `refund_on_listing` notification type so the
creator sees the chargeback in their bell. Reuses
`PurchaseOnListingPayload` with a different headline.

### Pre-flight gate on the create / edit forms

Today a creator can set `price > 0` on a listing without having
finished payout onboarding. The Purchase button still shows for
buyers, but the action gracefully returns an error so checkout
fails fast. Better UX: warn the creator at create / edit time
("Set up payouts before publishing this paid listing") with a link
to `/dashboard/settings/payouts`. Half-day add.

### Refund-aware earnings tab

Earnings sums `creatorPayout` for `status='completed'` only, which
is correct, but no negative line item shows up if a refund happens.
After refunds land, the earnings list should show refunds inline
(negative amounts) so the creator's mental model matches their
Stripe dashboard.

### Disconnect handling

If a creator deauthorizes their Stripe connection, `account.updated`
will flip `charges_enabled` to false and we set
`stripeOnboardingComplete` to false (already wired). What we don't
do: surface a banner on `/dashboard/settings/payouts` explaining
"Stripe says your connection was revoked — reconnect to start
receiving payouts again." Right now they just see "Onboarding
incomplete" with no context.
