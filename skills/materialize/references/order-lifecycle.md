# Order lifecycle — statuses, approval paths, money mechanics

Everything here describes what `materialize_create_order`, `materialize_get_order`,
and `materialize_list_orders` actually return. Report only states you have read from
a tool response.

## The two approval paths, in detail

### Path 1 — `awaiting_user_approval` (default)

`materialize_create_order` parks a draft order and emails the user a confirmation
link. Nothing is paid, nothing is placed.

- The response carries `confirmationUrl` and `expiresAt`. The link is valid for
  **24 hours**; after that the draft cannot be confirmed — if the user still wants
  the part, create a new order (fresh quote first; prices move).
- The user opens the link, reviews the order, and pays via Stripe Checkout.
  Depending on the account's checkout model, that page presents either a single
  payment or a service-fee authorization with production payment handled
  separately — the page guides the user; you don't need to.
- If the response includes a `reason` field, auto-approval was attempted and fell
  through (over budget, outside the policy's vendor/material allowlist, card
  declined, feature disabled). Relay it verbatim. Do not retry to force the auto
  path — the fallback IS the correct outcome.
- If the response warns that the confirmation email failed to send, the
  `confirmationUrl` you hold is the user's only way in. Give it to them directly.

### Path 2 — `auto_approved`

Only reachable when ALL of: the server-side agent-billing feature is enabled, the
user's token carries a spending policy, this order fits it, and the off-session
charge on their saved card **succeeded**. That means:

- **The card has already been charged** when you see this status. Say the amount.
- The order is placed with the vendor after a cancellation window — the response's
  `cancellationDeadline` is authoritative. The window is set by the user's policy
  (it can be zero); placement happens within about a minute after it passes.
- Until the deadline, the user can cancel via the emailed receipt link or their
  dashboard; cancelling refunds the charge in full.
- Policy budgets reset on server time (UTC): daily at UTC midnight, weekly on
  ISO Monday, monthly on the 1st. "Tomorrow" means tomorrow UTC, not the user's
  local midnight — mention this if a user asks why an order didn't auto-approve.

## Status vocabulary you may see from `materialize_get_order`

| Status | Meaning | What to tell the user |
| --- | --- | --- |
| `awaiting_user_approval` | Draft parked; email sent; not paid | "Check your email / open this link to approve and pay" |
| `auto_approved` | Card charged; waiting out the cancellation window | "Charged $X; cancellable until `cancellationDeadline`" |
| `cart_created` | Payment step underway/complete; vendor placement pending | "Payment received; being placed with the vendor" |
| `awaiting_production_payment` | Two-step checkout: fee authorized, production payment owed to the vendor network | "Complete the production payment via the link in your dashboard" |
| `ordered` | Placed with the vendor | This is the normal resting state — see note below |
| `in_production` / `shipped` / `received` | Fulfillment progression | Statuses exist, but see the honesty note |
| `blocked` | Vendor-side problem | Suggest contacting support |
| `cancelled` / `refunded` | Terminal | Confirm money outcome from the price fields, not assumption |

**Honesty note on fulfillment statuses:** vendor fulfillment sync is not yet live —
a healthy order typically *rests at `ordered`* even while physically in production
or shipped. Do not tell a user "it hasn't started production" because the status
still says `ordered`; say the order is placed and that status tracking beyond
placement is limited today. The `terminal` boolean on responses is authoritative
for "no further changes will happen."

## Money mechanics

- **Fee**: Materialize adds 3% of the pre-shipping subtotal (`serviceFeeCents`).
  Production + shipping prices come from the vendor's live quote and pass through.
- **`totalPriceCents` is authoritative.** It can slightly exceed
  `quantity × unit price` from your quote because vendors apply minimum-production
  fees. Present the order response's numbers, not your own arithmetic.
- **Currency**: USD only.
- **Quotes expire.** A quote-expired error at order time means re-quote. If the
  new price differs meaningfully, re-present before ordering — never silently
  order at a changed price.

## Idempotency and replay

`materialize_create_order` is idempotent on `(user, idempotencyKey)`:

- Generate one key (8–128 chars) per order *intent* and reuse it on retries after
  timeouts or network failures — the same draft comes back instead of a duplicate.
- A fresh key is a fresh order. Never mint a new key to "retry" an order that
  already exists.
- An "already started fulfillment" style error on replay means the original order
  progressed past the point of safe replay — it is REAL. Fetch it with
  `materialize_get_order` and report it; do not create another.
