# Refunds runbook

How refunds work in Materialize, and the **manual procedure for listing
refunds** so the platform doesn't eat fees or creator payouts.

## Two kinds of money, two refund paths

### 1. Print orders — refunded **in-app** (automated)

Print-order refunds run through `requestOrderRefund` (`app/actions/print.ts`)
and the agent auto-cancel path (`cancelAutoApprovedOrder`,
`app/actions/agent-orders.ts`). These are plain charges on the platform
account (no connected account), so a normal Stripe refund is correct and
complete. Both issue the refund with a deterministic idempotency key, and a
failed auto-cancel refund is retried by the `retry-failed-refunds` cron — no
manual action needed.

### 2. Listing purchases — refunded **manually in the Stripe dashboard** ⚠️

Listing purchases (a buyer paying a creator for a file/project) are **Stripe
Connect destination charges**: the buyer's payment is split so the creator
gets their cut (a transfer to their connected account) and the platform keeps
a 3% application fee. See `app/actions/checkout.ts` (`transfer_data.destination`
+ `application_fee_amount`).

There is **no in-app "refund this purchase" button** today. The only refund
handler, `lib/stripe/handle-listing-refund.ts`, is *reactive* — it flips the
`purchases` row to `refunded` when it receives a `charge.refunded` event. It
does **not** initiate the refund. So listing refunds happen **manually in the
Stripe dashboard**, and you must reverse the transfer and the fee yourself —
otherwise the platform is left out-of-pocket for the creator's payout and the
3% fee.

## Procedure: refunding a listing purchase

1. In Stripe → **Payments**, find the PaymentIntent (cross-reference the
   `purchases.stripePaymentIntentId` for the listing).
2. Click **Refund**.
3. **Check both options** before confirming:
   - ✅ **Reverse the transfer** — claws the creator's payout back from their
     connected account. (Stripe shows this for destination charges.)
   - ✅ **Refund the application fee** — returns the platform's 3% so we don't
     keep a fee on a refunded sale.
4. Confirm. Stripe fires `charge.refunded`; our webhook flips the `purchases`
   row to `refunded` automatically, which drops the buyer's download
   entitlement (`userOwnsFile` / `userOwnsProject` filter on
   `status='completed'`).

> If you skip step 3, the buyer is refunded from the **platform** balance
> while the creator keeps their transfer and we keep the fee — a direct loss.

## When to build the in-app version

If listing-refund volume grows, replace this manual step with an in-app action
that calls `stripe.refunds.create(pi, { reverse_transfer: true, refund_application_fee: true })`.
That lives in revenue-critical code (`lib/stripe/handle-*.ts` is human-review),
so it should be its own reviewed PR. Tracked in CON-45.
