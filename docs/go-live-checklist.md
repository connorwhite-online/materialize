# CraftCloud go-live checklist

Switching print checkout from sandbox to real orders. Merge PR #293 first:
it is safe on sandbox settings and runs migration 0064 on build.

Key values are **not** stored here. Set them only in Vercel → Project →
Settings → Environment Variables (Production), from the Stripe dashboard.

## Env vars (Vercel, Production)

Order matters: the app refuses to boot with a live Stripe key while
`CRAFTCLOUD_MOCK_CHECKOUT=true`, so do step 1 first.

1. Remove `CRAFTCLOUD_MOCK_CHECKOUT` (or set it to anything but `true`).
2. `CRAFTCLOUD_USE_MOCK=false`
3. `CHECKOUT_MODEL=two_step` — customer pays CraftCloud directly; we only
   hold the 3% fee. `single` needs a reseller/invoice agreement first.
4. `STRIPE_SECRET_KEY` → live `sk_live_…` key.
5. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → live `pk_live_…` key.
6. `STRIPE_WEBHOOK_SECRET` → signing secret of a **live-mode** webhook
   endpoint pointing at `https://<prod domain>/api/webhooks/stripe`
   (create it in the Stripe dashboard in live mode; the test one won't work).
7. `CRON_SECRET` set (gates the crons in `vercel.json`, including the
   hourly `reconcile-production-payments` and `sync-fulfillment-status`).
8. Redeploy so the new values take effect.

## Verify

- The amber "Sandbox" chip is gone from Order Summary and the cart.
- Place one small real order; enter the state as a two-letter code and
  the same country the quote was priced in. A phone number is required.
- After paying CraftCloud, check the order moves to `ordered` within the
  hourly reconcile and that the fee hold is captured.
- Watch the CraftCloud emails to that address for tracking info.

## Known gaps

- No way to cancel a CraftCloud order via API; go through their support.
- Payment confirmation relies on `lib/craftcloud/payment-confirmation.ts`
  (empty status history = unpaid). Recheck against the first real order.
- No tracking numbers from the status endpoint.
