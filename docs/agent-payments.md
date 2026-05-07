# Agent Payments — Design Doc

## 0. Status (2026-05)

**Phase 1 — Delegated Billing on the existing MCP.** Shipped behind `MATERIALIZE_AGENT_BILLING_ENABLED`. Default-off, no behavior change until flipped per-environment. 60 tests in `lib/billing/__tests__`, `lib/mcp/internal/__tests__`, `app/actions/__tests__`, `app/api/cron/place-auto-approved-orders/__tests__`.

Phase 1 surfaces:
- `lib/billing/policy.ts` — spending-policy evaluator
- `app/actions/billing.ts` — Stripe customer + SetupIntent + remove + summary
- `app/(app)/dashboard/settings/billing/` — saved-card UI
- `app/(app)/dashboard/settings/tokens/token-policy-editor.tsx` — per-PAT policy editor
- `lib/mcp/internal/orders.ts` — `createAgentInitiatedOrder` policy check + off-session charge
- `app/api/cron/place-auto-approved-orders/route.ts` — runs every minute, places orders past their cancel window
- `app/(app)/orders/[orderId]/cancel/` — cancel UI
- `lib/email/templates/agent-order-{auto-approved,cancellation-confirmed}.tsx`
- `app/api/webhooks/stripe/route.ts` — extended with the `mode=setup + metadata.type=billing_setup` branch that persists the saved payment method

**Phase 2 — ACP / UCP support.**

- *Stage 1 (Discovery surface).* Shipped. `app/llms.txt`, `app/llms-full.txt`, `app/(app)/materials/[slug]/page.tsx` (Offer JSON-LD), `app/robots.ts`, `app/sitemap.ts`. Public-route matcher in `proxy.ts` updated.
- *Stage 2 (Decision spike).* **Not started — next step.** See §13 below for the concrete checklist.
- *Stages 3–7.* Not started. See §10 for the architecture and §13 for the gating decisions.

## 1. Context

The MCP server (`docs/mcp-server.md`) shipped v1 with a hard gate: every agent-initiated order requires the human to click an emailed confirmation link before the Stripe Checkout session is minted. That's the right default for v1, but it kills the "agent designs and prints 20 parts overnight" workflow because the user is in the loop on every transaction.

Stripe has shipped a stack of primitives in the last ~6 months that solve this for real:

- **Agentic Commerce Protocol (ACP)** — open standard, Apache 2.0, co-designed with OpenAI. Defines product-discovery + cart + checkout endpoints that any compliant agent (ChatGPT, Claude apps, etc.) can drive.
- **Universal Commerce Protocol (UCP)** — Stripe's superset/successor naming for the protocol family. Same shape, broader ambition.
- **Shared Payment Tokens (SPTs)** — the new payment primitive. Buyer authorizes a token at their AI provider scoped to (seller, time, amount). Merchant redeems via Stripe at order time. **Buyer's payment method never leaves the AI provider's vault.**
- **Machine Payments Protocol (MPP)** — separate spec, March 2026, for pure machine-to-machine billing (microtransactions, recurring service calls). Stablecoin support. Not relevant for Materialize today — agents are buying physical goods on behalf of humans.
- **Agentic Commerce Suite** — Stripe's hosted product that bundles discovery + checkout + SPT redemption. The "easy mode" path; you connect your catalog and toggle which agent platforms you want to be discoverable through.

Two integration philosophies emerge from this:

- **"Be discoverable to any agent."** Implement ACP. Any user on any compliant agent platform can buy from Materialize without us having a direct integration with that platform.
- **"Deep integration with our MCP."** Keep the existing MCP, plus give users a way to pre-authorize agent spending with stored payment methods + Materialize-side policy (per-order cap, daily/weekly cap, vendor whitelist). Works only through our MCP, but exposes more capability (file uploads, vendor selection, geometry preview) than ACP can.

These are **additive**, not alternatives. v1 of agent payments should ship the second (it's a smaller surface, builds on existing primitives) and treat the first as a Phase 2 once ACP stabilizes and we have evidence it's where buyers are.

## 2. Goals

### Phase 1 — Delegated Billing on the existing MCP

- Let users attach a saved payment method to their account.
- Let users attach a **spending policy** to a personal access token (per-order limit, period budget, vendor allowlist).
- Auto-charge stored payment method when an agent-initiated order is within policy. Skip the email confirmation loop.
- Out-of-policy orders fall back to today's confirm-via-email flow with a clear `reason` in the tool response.
- Receipt-style notification email after every auto-approved order with a 5-minute cancellation window before the CraftCloud order is placed.
- Surface agent metadata (`token_id`, `policy_version`) to Stripe Radar so risk models can be agent-aware.

### Phase 2 — ACP / UCP support

- Implement ACP product-discovery endpoints so the CraftCloud catalog is browsable by ACP-compliant agents.
- Implement ACP cart/checkout endpoints that accept SPTs and redeem them via Stripe.
- Decide whether to also list on Stripe's hosted Agentic Commerce Suite (lower lift, less control) or self-host the ACP endpoints (more lift, full control).

## 3. Non-goals (Phase 1)

- ACP/UCP support. Phase 2.
- MPP support. Materialize sells physical goods to humans; MPP is for machine-to-machine recurring billing. Skip.
- Stripe Issuing virtual cards per token. Elegant for cost attribution at scale, overkill for v1.
- Full PCI scope expansion. Continue using Stripe-hosted SetupIntent flows; Materialize never sees raw card data.
- Agent-initiated refunds or order modifications. Read-only on existing orders.

## 4. Architecture (Phase 1)

```
Agent ─MCP─▶ materialize_create_order
              │
              ├─▶ Look up PAT.spending_policy
              ├─▶ Look up users.stripe_customer_id + default_payment_method
              ├─▶ Look up spending_ledger for token in current period
              │
              ├──IF within policy──▶ Stripe PaymentIntent (off-session, confirm: true)
              │                       │
              │                       └─▶ printOrder.status = 'auto_approved'
              │                       └─▶ Email user "your agent placed an order — cancel within 5 min"
              │                       └─▶ after 5min: webhook places CraftCloud order
              │
              └──IF over policy────▶ existing flow:
                                       printOrder.status = 'awaiting_agent_approval'
                                       Email user with confirmationUrl
                                       (unchanged)
```

The CraftCloud-placement step (Stripe webhook → `handlePrintOrderPayment` → CraftCloud cart submission) is unchanged. Only the path to "Stripe charge succeeded" differs. This means existing fulfillment, refund handling, tracking, and order-status surfaces all work without modification.

## 5. Schema changes

### Phase 1.a — Spending policies

```sql
ALTER TABLE personal_access_tokens
  ADD COLUMN spending_policy jsonb;
```

Shape (TypeScript):

```ts
type SpendingPolicy = {
  perOrderLimitCents: number;          // hard cap per single order
  periodBudgetCents: number;           // cap per rolling window
  periodWindow: 'day' | 'week' | 'month';
  confirmAboveCents?: number;          // optional soft threshold — if set, orders above this require email confirm even within budget
  allowedVendorIds?: string[];         // optional whitelist
  allowedMaterialIds?: string[];       // optional whitelist
};
```

Null `spending_policy` means "no auto-approval, every order needs confirmation" — which is today's behavior. So the default for existing tokens is unchanged.

### Phase 1.b — Spending ledger

```sql
CREATE TABLE token_spending_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id        uuid NOT NULL REFERENCES personal_access_tokens(id) ON DELETE CASCADE,
  print_order_id  uuid NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
  amount_cents    integer NOT NULL,
  charged_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX token_spending_ledger_token_id_charged_at_idx
  ON token_spending_ledger (token_id, charged_at);
```

Used to compute "cents spent in current period" without scanning all of `print_orders`. Period boundary is computed in app code (`day` = since last UTC midnight, etc.), not stored.

### Phase 1.c — Customer + payment method

```sql
ALTER TABLE users
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN default_payment_method text;  -- "pm_..."
```

Both nullable. The presence of `default_payment_method` is what gates a token's policy from actually working — if the user has a policy but no card on file, every order falls through to confirm-via-email with reason "no payment method on file".

### Phase 1.d — Order status

Extend the `print_order_status` enum with `auto_approved`. Live state, sits between `awaiting_agent_approval` and `cart_created`. Only used for audit/analytics — the webhook handling treats it the same as `cart_created`.

## 6. New tools and tool changes

### Existing tool, new behavior

`materialize_create_order` response gains two new branches:

```jsonc
// Auto-approved within policy
{
  "orderId": "...",
  "status": "auto_approved",
  "totalPriceCents": 4500,
  "serviceFeeCents": 135,
  "currency": "USD",
  "chargedAt": "2026-05-06T22:30:00Z",
  "cancellationDeadline": "2026-05-06T22:35:00Z",
  "remainingPeriodBudgetCents": 15500,
  "policyVersion": 1
}

// Hits the policy ceiling — falls back to email confirm
{
  "orderId": "...",
  "status": "awaiting_user_approval",
  "confirmationUrl": "https://...",
  "reason": "Exceeds per-order limit ($50.00 cap, this order $87.30)",
  "totalPriceCents": 8730,
  // ...
}
```

The agent doesn't need to know which mode it's in — same code path, different `status`. Documenting `terminal: false` in both means agents can poll `materialize_get_order` to track which path the order took.

### No new tools required

Spending policy management is **deliberately** dashboard-only, not exposed as MCP tools. Reason: the policy is the user's safeguard against the agent — letting the agent edit its own policy would defeat the purpose. The token-creation page already lives at `/dashboard/settings/tokens`; add a policy editor there.

## 7. Stripe integration details

### Setting up the customer + payment method

New server action `setupBillingForAgentOrders`:

1. If user has no `stripe_customer_id`, create one with `email + name + metadata.materialize_user_id`.
2. Create a SetupIntent with `usage: 'off_session'`.
3. Return the client secret to a small "Save a card" page at `/dashboard/settings/billing`.
4. On confirmation, the SetupIntent's `payment_method` becomes `users.default_payment_method`.

This is its own UI surface, separate from the per-order Checkout that today's anon flow uses. Existing anon and logged-in checkout flows are untouched.

### Charging on agent order

In `createAgentInitiatedOrder`, when the policy check passes:

1. Create a `PaymentIntent` with:
   ```ts
   {
     amount: totalPriceCents,
     currency: 'usd',
     customer: user.stripeCustomerId,
     payment_method: user.defaultPaymentMethod,
     off_session: true,
     confirm: true,
     metadata: {
       printOrderId: order.id,
       source: 'agent',
       token_id: token.id,
       policy_version: '1'
     }
   }
   ```
2. On success → `printOrder.status = 'auto_approved'`, write `token_spending_ledger` row.
3. On `requires_action` (3DS challenge) → fall through to email-confirm flow with `reason: "Card requires authentication"`. The card issuer is asking for a human; honor that.
4. On `card_declined` → return `error_code: "card_declined"` and `terminal: true`. Don't auto-retry.

### Cancellation window

Between `auto_approved` and the CraftCloud-placement webhook handler, hold for 5 minutes. The user gets a "your agent just placed an order, cancel within 5 minutes" email with a one-click cancel link. After 5 min, the webhook proceeds and places the CraftCloud order.

Implementation: a column `auto_approved_until` on `print_orders`. The webhook handler that places CraftCloud orders skips rows where `auto_approved_until > now()`. A scheduled job (or Vercel Cron, since you already use them for stale-order cleanup) runs every minute and triggers the placement for any row where the deadline has passed.

This gives users a real "undo" without making the agent's tool call laggy. The agent's `create_order` returns immediately with `status: "auto_approved"`; the user has 5 min to slap the cancel button before fulfillment kicks in.

## 8. UI changes

### `/dashboard/settings/billing`

New page. Card on file, "remove" button, last-4 + brand display. Single SetupIntent flow. ~half a day of work.

### `/dashboard/settings/tokens` — policy editor per token

Existing page gets a "Spending policy" section per token row:

- Toggle: "Allow this agent to charge me automatically" (off by default)
- Per-order limit (input)
- Period (radio: day / week / month) + budget (input)
- Confirm-above threshold (optional)
- Vendor + material allowlists (collapsed by default; "Restrict to specific vendors/materials…")
- Show recent spending: "Used $X of $Y this period"

When the toggle is on but `users.default_payment_method` is null, show a banner: "Add a payment method to enable auto-approval →".

### Notification emails

Two new templates in `lib/email/templates/`:

- `agent-order-auto-approved.tsx` — "Your agent just placed an order. Cancel within 5 minutes." Single CTA: cancel.
- `agent-order-cancellation-confirmed.tsx` — "We've cancelled the order. No charge will be made." Trivial.

Existing `agent-order-confirmation.tsx` (the current "review and confirm" email) keeps working unchanged for out-of-policy orders.

## 9. Risk + safety

- **Charge before fulfillment.** Stripe charge happens before the CraftCloud order is placed. If CraftCloud rejects (geometry issue, vendor unavailable), refund automatically — extend the existing `blocked → refunded` flow.
- **Velocity limits across tokens.** A user with 3 PATs each at $50/day could legitimately spend $150/day. That's intended. If we want a global per-user cap, add it on `users` and check it alongside the per-token policy.
- **Stolen tokens.** Token compromise is now financially material in a way it wasn't in v1. Mitigations: dashboard shows recent activity per token with "this is suspicious, revoke" CTA; rate-limit is implicit in the per-period budget; consider 2FA-style email-confirm-on-first-use-from-new-IP (deferrable to phase 1.5).
- **Refunds + chargebacks.** Document the cancellation window prominently. After it passes, refund policy follows existing rules (CraftCloud won't refund a placed order; user disputes go through the existing channels).
- **Radar metadata.** Tag every PaymentIntent with `metadata.source: 'agent'` and `metadata.token_id`. Stripe is building agent-aware risk models; feeding them clean data helps everyone.

## 10. Phase 2 — ACP / UCP support

Ship right after Phase 1 stabilizes. The Phase 1 architecture deliberately leaves room: `auto_approved` already exists as a status, Stripe payment infrastructure is already in place, only the discovery + cart endpoints and SPT-as-payment-method are net-new.

### Path: Stripe's Agentic Commerce Suite first, self-host if needed

The hosted Suite is the cheapest entry point — connect the CraftCloud catalog, toggle which agent platforms to be discoverable through, Stripe handles the discovery + checkout endpoints. Order events feed into the existing fulfillment pipeline. Less code, broader reach, less control.

If/when we hit a wall (Stripe Suite UX doesn't fit our flow, takes a cut we don't like, can't expose enough material/finish detail), switch to self-hosted ACP endpoints at `/api/acp/products`, `/api/acp/cart`, `/api/acp/checkout`. Most CraftCloud catalog data maps cleanly to ACP product shape; quotes are dynamic so the discovery endpoint surfaces material UUIDs + base info and the cart endpoint runs the existing quote pipeline. SPT redemption is just another `payment_method` source on the same PaymentIntent code path Phase 1 already uses.

### What changes vs Phase 1

- **No spending-policy check.** ACP buyers authorize spending at their AI provider via SPT scope — Materialize just redeems the token. The `spending_policy` system stays for direct-MCP integrations.
- **No cancellation window** by default. SPT scoping is the buyer's safeguard; once we accept the token Stripe expects fulfillment. (Refund still works the normal way.)
- **No new email confirmation flow.** ACP buyers never see a Materialize email — their agent surface handles all comms.
- **Discovery surface.** A `llms.txt`/JSON-LD pass + the Suite catalog feed; defer until Phase 1 is shipped so we have real agent traffic data to inform what to expose.

### Decision points during build

- Stripe Suite vs self-hosted ACP — pick after Phase 1 lands and we can A/B the integration time.
- Catalog scope — expose all CraftCloud materials, or curate a subset for ACP discovery? (Probably curate to start: too many SKUs creates analysis paralysis for buyers.)
- Pricing — same 3% service fee, or different rate for ACP-discovered orders? Worth modeling before launch.

## 11. Migration / rollout

1. **Schema migrations** (additive, no data loss): `personal_access_tokens.spending_policy`, `users.stripe_customer_id`, `users.default_payment_method`, `token_spending_ledger`, `print_order_status` enum extension, `print_orders.auto_approved_until`.
2. **Feature-flagged rollout.** Behind `MATERIALIZE_AGENT_BILLING_ENABLED` env flag. Internal users get it first; flip it on globally once the cancellation flow is exercised end-to-end.
3. **Backwards compat.** All existing tokens have `spending_policy: null` → behave exactly as today. New users opt in by adding a card and configuring a policy.
4. **Cron job** for the 5-minute cancellation window. Re-use the pattern from `/api/cron/cleanup-stale-orders`.
5. **Stripe webhook updates.** Handle `payment_intent.succeeded` and `payment_intent.payment_failed` for off-session charges. The existing `checkout.session.completed` handler stays for non-policy orders.

## 12. Open questions

1. **Cancellation window length.** 5 minutes is a guess. Real users may want longer (30 min) or no window at all (instant fulfillment for trust-the-agent users, opt-in via policy). Worth a per-policy setting: `cancellationWindowMinutes: 0 | 5 | 15 | 30`.
2. **Receipts.** Do we send a separate receipt email after the cancellation window passes, or is the auto-approved email sufficient? Probably yes — confirms "the order is now placed and on its way."
3. **Multi-currency.** Phase 1 stays USD only (matches the MCP fix from earlier this week). Phase 2 needs to think about agent platforms that surface non-USD prices.
4. **Deal with the existing `awaiting_agent_approval` email.** Does it still get sent for out-of-policy orders, or only when no policy is configured at all? Probably the former for safety.

## 13. Phase 2 Stage 2 — Decision spike checklist

The next concrete step on Phase 2. Output is an addendum to this doc with the answers to the two questions below; everything from Stage 3 onward depends on them. This section is the running brief — pick it up cold.

### Question A: Hosted Stripe Agentic Commerce Suite vs self-hosted ACP endpoints?

**To answer:**

1. Sign in at https://dashboard.stripe.com with the existing Materialize Stripe account.
2. Look for "Agentic Commerce" / "Agent Connect" / similar in the dashboard nav. Document what's actually there (Stripe is iterating; the nav label may have changed since this was written).
3. If self-serve, walk the enrollment flow — note what catalog format it expects (Stripe Products? a custom feed URL? CSV upload? webhook callback?), what events it emits, and what UX the buyer sees on the agent platform side.
4. If gated behind a sales call, decide whether the timeline cost is worth waiting on. Self-hosted ACP is the alternative.

**Decision criteria:**

- Hosted is the right answer if: Stripe Suite supports either dynamic pricing (a price-on-demand callback) or accepts a "starting from" price model AND order events flow through the existing `/api/webhooks/stripe` route with minimal new branching.
- Self-hosted is the right answer if: Stripe Suite forces fixed-SKU pricing, requires a sales engagement to enroll, OR doesn't expose enough material/finish detail to drive a real quote.

**Default fallback if undecided:** start hosted, fall through to self-hosted only when blocked. The Stage 3 catalog feed is shared work between the two paths, so committing isn't required to start Stage 3.

### Question B: Pricing model for the dynamic-quote problem?

Materialize prices are computed at quote time per (model geometry × material × vendor). ACP catalogs assume buyers can see prices upfront. Three options, see §1 of this doc for the full discussion:

- **A — "Starting from" pricing.** Benchmark each material against a fixed reference geometry (probably a 30mm calibration cube), refresh nightly, surface that as the discoverable price. Real price comes back at cart time.
- **B — Curated instant-quote SKUs.** Pick ~10–20 common parts (calibration cubes, hooks, brackets, common figurines), pre-quote across all materials, surface those as fixed-price ACP SKUs.
- **C — Quote-at-cart upload.** ACP discovery surfaces materials only; cart endpoint accepts a model upload and runs the existing quote pipeline.

**To answer:**

1. Verify which agent platforms (ChatGPT, Claude apps, Perplexity, etc.) actually have ACP buyer-side support shipped today. Without buyers, the choice is theoretical.
2. Look at what those platforms expect from a merchant catalog — fixed SKUs only, or do they handle "starting from" pricing gracefully? File-upload flows? Quote-at-cart?
3. Pick.

**Recommendation (revisit when answering):** A + B together. Curated SKUs cover the fast happy-path; "starting from" pricing covers the broader catalog with a re-quote at cart. C is the eventual destination but probably needs ACP to mature.

### What this stage produces

Append a new §14 to this doc titled "Phase 2 Stage 2 — Decisions" with:

1. **Choice for Question A** + a paragraph on what tipped it (with screenshots / links to whatever Stripe surface was inspected).
2. **Choice for Question B** + criteria used.
3. Any new constraints that surfaced during the spike (e.g. "Stripe Suite caps catalog at 10k SKUs", "Claude apps' ACP buyer doesn't support file uploads yet").
4. Updated estimate of which existing Phase 1 surfaces will be reused vs net-new for Stage 3+.

Once §14 is written, Stage 3 (catalog feed) is unblocked and can start without further input.
