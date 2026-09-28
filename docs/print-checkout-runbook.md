# Print checkout and order crons: runbook

For anyone (human or agent) picking up print checkout cold: what the
live flow is, where it is weak, what to do about it, and how to debug
an order that looks wrong. Written 2026-09-28, after the first live
two-step order (MZ-73EECF, JawsTec SLS PA12, $26.43 paid to CraftCloud,
$0.99 fee held and then captured).

Related: `docs/go-live-checklist.md` (env flip), AGENTS.md § "Two-checkout
flow" and § "Print order status machine" (the canonical state map).

## 1. What runs in production today

`CHECKOUT_MODEL=two_step`, live Stripe keys, `CRAFTCLOUD_USE_MOCK=false`.
Single checkout (we charge everything and pay CraftCloud) is still in the
code but needs a reseller/invoice agreement first (§ 4).

```
completePrintOrder (app/actions/print.ts)
  1. prepareTwoStepOrder
       createOrder          → CraftCloud order placed UNPAID, id saved
       createStripeCheckout → CraftCloud's hosted payment ("bridge") URL saved
  2. fee: saved card one-tap | embedded fee sheet (Payment Element) | hosted Checkout
       all are capture_method: manual → our 3% fee is a HOLD
  3. finalizeFeeAuthorization / webhook backstop
       cart_created → awaiting_production_payment, feePaymentIntentId + feeAuthorizedAt
  4. buyer is sent to the bridge URL and pays CraftCloud directly
  5. CraftCloud returns them to /dashboard/orders?production=paid&orderId=…
       → reconcileOrderForUser checks that one order right away (PR #297)
  6. hourly reconcile-production-payments (backstop for step 5)
       paid      → capture fee, notifyPrintOrderPlaced, → ordered
       >72h      → cancel the hold, → cancelled
  7. hourly sync-fulfillment-status
       ordered → in_production → shipped → received (+ blocked / cancelled)
```

### The crons that touch print orders (`vercel.json`)

| Route | Schedule (UTC) | Does |
|---|---|---|
| `reconcile-production-payments` | `0 * * * *` | two-step: capture fee when CraftCloud is paid, cancel hold after 72h |
| `sync-fulfillment-status` | `40 * * * *` | moves orders past `ordered` by polling CraftCloud |
| `cleanup-stale-orders` | `0 9 * * *` | cancels `cart_created` rows older than 48h (see pitfall 3) |
| `retry-failed-refunds` | `0 */6 * * *` | retries refunds flagged `refundFailedAt`; writes no status |
| `craftcloud-upload-canary` | `17 * * * *` | uploads a test solid to CraftCloud to catch API breakage |
| `place-auto-approved-orders` | minutely (agent/MCP orders only) | not used by two-step |

All of them require `Authorization: Bearer $CRON_SECRET` and return 500
if `CRON_SECRET` is unset. Vercel only runs crons on the **production**
deployment, never on previews.

## 2. Why polling at all: CraftCloud facts

Verified against CraftCloud's spec (https://swagger.craftcloud3d.com,
raw: https://api.craftcloud3d.com/api-docs.json) and live runs on
2026-09-27:

- **No webhooks or callbacks.** Only a price websocket. Every state
  change on their side is invisible to us until we poll.
- `GET /v5/order/{id}/status` returns per-vendor status **history**, no
  payment field, no tracking numbers. `normalizeOrderStatus`
  (`lib/craftcloud/order-status.ts`) collapses it; never read the raw
  payload elsewhere.
- **An unpaid order has an empty history** (`orderStatus: []`). A paid
  order gets entries. `isProductionPaymentConfirmed`
  (`lib/craftcloud/payment-confirmation.ts`) treats any of
  ordered/in_production/shipped/received as paid. Confirmed empty-when-
  unpaid by the invoice runs, and confirmed paid-flips-it by MZ-73EECF.
- **No cancel endpoint.** Cancelling a placed order means emailing
  CraftCloud support.
- **Shipping phone is required** on `POST /v5/order` (400 otherwise).
  Checkout and the MCP tool both require it now.
- **Invoice payment** (`POST /v5/payment/invoice`) is open to us, but a
  real invoice is a pro-forma PDF: pay by wire/ACH first, production
  starts after they match the payment. No token and no Net 30 by
  default. A *test* invoice echoes the order id and the order then 404s.
- **Vendor minimums** only show up on a cart, never on a quote. The
  picker learns them with a throwaway cart per vendor
  (`lib/craftcloud/vendor-minimums.ts`).
- The cloud agent environment gets 403 from `api.craftcloud3d.com`. Any
  live CraftCloud call has to run from Connor's machine (Remote Control)
  or be pasted in by a human.

## 3. Downsides and pitfalls

Ordered roughly by how much they can hurt. "Status" says whether it is
fixed, open, or a design limit.

### Money and order state

1. **Abandoned fee step leaves a placed, unpaid CraftCloud order.**
   Step 1 places the CraftCloud order *before* the buyer authorizes our
   fee. Close the tab at the fee sheet and CraftCloud holds an unpaid
   order that nobody will pay. Harmless (nothing prints unpaid), but it
   is noise on CraftCloud's side and there is no API to cancel it.
   *Status: design limit of two-step. Remedy: place the CraftCloud order
   after the fee hold, not before, if the noise ever matters.*

2. **Late payment after the 72h abandonment cancels our side only.**
   If a buyer pays CraftCloud after reconcile has already cancelled the
   hold (`ABANDONMENT_TTL_MS`, `lib/stripe/reconcile-production-payments.ts`),
   CraftCloud prints the part, we never earn the fee, and our row stays
   `cancelled`. `sync-fulfillment-status` skips `cancelled`, so the order
   is invisible to us from then on. The bridge URL stays in the buyer's
   history and CraftCloud's emails, so this is reachable.
   *Status: open. Our own resume path already refuses to hand out the
   bridge URL once the hold is gone (`resumeTwoStepProductionPayment`);
   the leak is the URL living on outside our app. Remedy: keep syncing
   `cancelled` two-step rows that still have a `craftCloudOrderId` for a
   while and alert if CraftCloud reports them paid, and ask CraftCloud
   whether an unpaid order's payment link can be expired.*

3. **Abandoned two-step carts are never cleaned up by the cron.**
   `cleanup-stale-orders` skips any row with a `craftCloudOrderId`
   (MTR-229), and two-step writes that id in step 1. So a two-step order
   abandoned before the fee hold sits at `cart_created` forever. This is
   why the five "Caribiner Hook" carts from the first live night did not
   clear themselves. The user can press Discard (`discardDraftOrder`).
   *Status: open. Remedy: in cleanup, cancel stale two-step rows where
   `checkoutModel = 'two_step'`, `status = 'cart_created'` and the fee
   PaymentIntent is not `requires_capture` / `succeeded` (nothing was
   held, nothing to refund). Keep the MTR-229 exclusion for `single`.*

4. **Fee capture and the DB write are not atomic.** `captureFeeAndPlaceOrder`
   captures in Stripe, then updates the row. A crash in between is healed
   on the next sweep (PI `succeeded` → `ordered`), but that heal branch
   does **not** call `notifyPrintOrderPlaced`, so the buyer and creator
   get no "order placed" email. *Status: open, low frequency. Remedy:
   notify in the heal branch when the conditional update wins.*

5. **Vendor cancellations are not refunded automatically.** If
   CraftCloud or the vendor cancels after the buyer paid CraftCloud, the
   sync marks us `cancelled` and logs
   `syncFulfillmentStatuses.vendorCancelled`. Our captured fee is not
   refunded and CraftCloud's refund is theirs to run. *Status: manual.
   Remedy: refund the fee from the alert; ask CraftCloud how their
   refunds work.*

### Latency and visibility

6. **Up to an hour of "Awaiting production payment".** CraftCloud can
   take a moment to record payment, so the on-return check (PR #297) can
   miss and the buyer waits for the next `:00` sweep. Reloading the orders
   page with the same `?production=paid&orderId=` query re-runs the
   check. *Status: acceptable; the two paths are race-safe.*

7. **Fulfillment lags up to an hour and has no tracking.** Status moves
   at `:40` each hour. Customers see "Shipped" with no tracking link;
   tracking only arrives in CraftCloud's own emails to the buyer's
   address. *Status: design limit. Remedy: as a reseller, set the
   CraftCloud order email to an inbox we own (for example
   `orders+<id>@…`) and parse tracking out of their emails; or get a
   tracking endpoint from CraftCloud.*

8. **Sweeps cap at 500 rows.** Both reconcile and fulfillment select
   `.limit(500)`. Reconcile orders by `feeAuthorizedAt`; fulfillment has
   no `ORDER BY`, so past 500 active orders some rows can be starved.
   Each row costs one CraftCloud GET per hour, and CraftCloud's rate
   limits are unknown. *Status: fine at today's volume. Remedy: add an
   `ORDER BY updatedAt` and a `lastSyncedAt` column before volume nears
   the cap.*

9. **An order that never reports `received` is polled forever.** `shipped`
   stays in `SYNCABLE_STATUSES`. *Remedy: stop polling `shipped` rows
   after some age (for example 30 days) and mark them received.*

10. **A cron reports 500 if any single row errored.** That is deliberate
    (Vercel shows the run as failed), but one bad order makes every run
    red until it is fixed. Read the JSON body (`errors`, `pending`,
    `captured`, …) before assuming the whole sweep broke.

### Checkout UX

11. **The buyer pays twice, on two sites.** Our fee sheet, then
    CraftCloud's Stripe page. Link asks them to verify again on
    CraftCloud's page because it is a different Stripe account. Drop-off
    between the two is the biggest unknown; measure it on the first real
    orders. *Remedy long-term: single checkout via invoicing (§ 4).*

12. **Apple Pay does not show on the fee sheet** even though it is
    enabled in live mode and the domain was added. Link shows. Not yet
    diagnosed. Check, in order: the domain in Stripe → Settings →
    Payment method domains is the exact host (apex and `www`) and shows
    verified in **live** mode; Safari on a device with a card in Wallet;
    whether the embedded Payment Element is created with a PaymentIntent
    whose `payment_method_types` or automatic methods include Apple Pay.
    *Status: open.*

13. **Pre-launch test orders clutter the profile.** Sandbox-era orders
    live in the production DB. PR #298 adds a test-order flag, backfills
    everything before the live switch, and hides them. *Status: open PR.*

### Fixed during the first live run (for context)

- Real orders were flagged `isTestOrder` when `CAD_RUNNER_URL` was unset
  (PR #293, `isCraftCloudTestOrder` in `lib/env.ts`).
- Status parser expected the wrong shape; every live check would have
  thrown (PR #293).
- Phone was optional; CraftCloud rejects orders without it (PR #293).
- Bridge session response is `{ id, url }`, not `{ sessionId, sessionUrl }`;
  checkout failed with "No values to set" (PR #295).
- A user's saved card from test mode doesn't exist under live keys; a
  fresh live customer is now created (PR #295).
- Checkout errors were hidden behind the address form; the checkout
  claim wasn't released after an error (PRs #294, #295).
- Card form collapsed by default (PR #296). No check on return from
  CraftCloud (PR #297).

## 4. Remedies worth pursuing (bigger than a bug fix)

1. **Ask CraftCloud for Net 30 or an invoice token.** With either,
   `CHECKOUT_MODEL=single` works: one charge to the buyer, we pay
   CraftCloud, and payment detection stops being a heuristic because we
   are the payer. Without it, invoicing means wiring money per order and
   waiting for them to match it. The technical-questions email draft is
   in the "CraftCloud live order readiness" thread.
2. **Also ask for:** webhooks or a tracking endpoint, rate limits for
   hourly polling, how cancellations and refunds work, and whether an
   unpaid order's payment link can be expired.
3. **Fix pitfalls 3 and 4** (cleanup of abandoned two-step carts, notify
   on heal). Both are small and local.
4. **Keep the vendor layer swappable.** Shapeways quoted ~$50 for the
   same part CraftCloud delivered for $26.43, so CraftCloud stays; a
   direct partner (see `docs/direct-partner-rate-card.md`) is the
   fallback, not Shapeways.

## 5. Troubleshooting an order, from a cold start

### First: where is the order?

Look up the row (`printOrders`) by our id or the `MZ-…` number and read
`status`, `checkoutModel`, `craftCloudOrderId`, `stripeSessionId`,
`feePaymentIntentId`, `feeAuthorizedAt`, `feeCapturedAt`,
`bridgeSessionUrl`. Remember the overloaded columns:

- `stripeSessionId`: `cs_…` Checkout session, `pi_…` PaymentIntent
  (embedded fee sheet or agent charge), or `session_claim:…` sentinel.
  Never pass it to `checkout.sessions.retrieve` without checking.
- `craftCloudOrderId`: a real id or a `placing:…` sentinel (single
  checkout only).

Then match the symptom:

| Symptom | Likely cause | What to check / do |
|---|---|---|
| "Failed to create checkout" | Catch-all in `completePrintOrder` | Vercel logs, search `completePrintOrder`. The tag after the dot names the step: `.twoStep.createOrder`, `.twoStep.createStripeCheckout`, `.retrieve`, `.savedCardSummary`. |
| "Could not place your order with the print service" | CraftCloud rejected `POST /v5/order` | Usually address: state must be a 2-letter code, country must match the quote's country, phone required. |
| "Checkout already in progress" | A `session_claim:` sentinel left on the row | Fixed in #295 for thrown errors. If it recurs, null `stripeSessionId` on that `cart_created` row. |
| Stuck at `cart_created` with a `craftCloudOrderId` | Buyer abandoned at the fee step (pitfall 3) | Safe to Discard. Nothing was held or charged. |
| Stuck at `awaiting_production_payment` | Buyer hasn't paid CraftCloud, or CraftCloud hasn't recorded it | Get the CraftCloud status (below). Empty history = unpaid. If it has entries but we didn't capture, reconcile errored: search logs for `reconcileProductionPayments`. |
| Stripe shows the fee "Uncaptured" | Normal until CraftCloud is paid | Capture happens on return or at the next `:00`. |
| Fee hold canceled, order `cancelled` | 72h abandonment, or Stripe's ~7-day auth expiry | Check CraftCloud status; if they show it paid, it's pitfall 2: handle by hand. |
| `ordered` for days | Vendor hasn't reported, or sync errored | CraftCloud status; logs for `syncFulfillmentStatuses.order`. |
| `cancelled` after `ordered` | Vendor/CraftCloud cancelled | Log `syncFulfillmentStatuses.vendorCancelled`; refund our fee by hand, contact CraftCloud. |
| Webhook-side errors | Wrong `STRIPE_WEBHOOK_SECRET`, missing events | Live endpoint must send `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.amount_capturable_updated`, `charge.refunded`. Logs: `handlePrintOrderPayment.*`. |
| `No such PaymentMethod` / customer errors | Test-mode Stripe ids on a user after the live switch | Fixed in #295 (fresh live customer). |
| `rememberCheckoutPhone` failed query | Migration 0064 (`users.phone_number`) not applied | Check the build log for `db:migrate`; run `npm run db:migrate` against prod `DATABASE_URL`. Doesn't block checkout. |

### Reading CraftCloud's side

The agent cloud environment can't reach CraftCloud. Either:

- ask Connor to open `https://api.craftcloud3d.com/v5/order/<craftCloudOrderId>/status`
  in a browser (no auth) and paste the JSON, or
- start a Remote Control session on his machine and `curl` it there.

`orderStatus: []` = unpaid. Entries like `ordered`, `in_production`,
`shipped` = paid and moving. `cancelled: true` on a vendor = cancelled.

### Running a cron by hand

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<prod domain>/api/cron/reconcile-production-payments
curl -H "Authorization: Bearer $CRON_SECRET" https://<prod domain>/api/cron/sync-fulfillment-status
```

Both are safe to run at any time: every write is conditioned on the
status just read, so they can't double-capture or walk an order
backwards. The JSON body reports `captured / cancelled / pending /
errors` (reconcile) or `scanned / updated / errors` (sync).

### Scripts (run from a machine that can reach CraftCloud)

- `scripts/test-craftcloud-invoice.ts --email <inbox> --yes`: places an
  unpaid order on the canary solid and makes a **test** invoice. Prints
  every response. Never pays.
- `scripts/test-craftcloud-minimums.ts`: vendor minimum discovery.
- `scripts/test-craftcloud-flow.ts`: upload, quote and cart walk. Its
  `--place-order` flag places a real order; don't use it casually.

Anything that would place a real order or real invoice must be run by
Connor himself; agent safety checks block it, correctly.

### Local testing

Use `CRAFTCLOUD_USE_MOCK` (default on) or `CRAFTCLOUD_MOCK_CHECKOUT=true`
with Stripe test keys. The mock CraftCloud payment page is
`/sandbox/craftcloud-pay`. Run `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` or orders never leave `cart_created`.
Mocks return our own shapes, so they will not catch CraftCloud response
shape changes; that is what the live canary and a real small order are
for.
