<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## What this project is

Materialize is a 3D-print marketplace + instant-quote flow. Users upload models, browse/purchase files from other creators, and order physical prints through third-party manufacturers (CraftCloud). Revenue comes from a 3% service fee on print orders.

## Critical flows (know these before touching anything)

### Print quote pipeline

The hot path. Touched weekly, easy to break.

```
/materials/[slug]            →  "Print with X" button
/print?material={ccId}       →  PrintPageContent (mobile stacks, desktop overlays)
  ├── anon:  FileUploader → uploadFileToCraftCloud → QuoteConfigurator(draftMode)
  └── authed: library tile → /print/[fileAssetId] → QuoteConfigurator(fileAssetId)

QuoteConfigurator:
  ensureModelUploaded (skipped in draft mode)
  → fetchQuotes:
      POST /api/craftcloud/quotes      (start)  → returns priceId
      GET  /api/craftcloud/quotes/poll (loop)   → snapshots until stable
  → MaterialPicker: Material → Finish → Vendor + color
  → PriceDisplay "Proceed to Checkout"
  → ShippingAddressForm
      └── anon: Clerk OTP in-form signup → then run the chain
  → [anon only] presign → R2 PUT → createDraftFileForPrint
  → createPrintOrder     (creates CraftCloud cart + printOrders row)
  → completePrintOrder   (creates Stripe checkout session, returns URL)
  → Stripe-hosted checkout
  → webhook: POST /api/webhooks/stripe → places real CraftCloud order
```

**Polling invariant** — `/api/craftcloud/quotes/poll` is polled by the client until CraftCloud reports `allComplete: true` AND the quote count has been stable for 4 consecutive polls (`STABLE_POLLS_REQUIRED = 4`, `POLL_INTERVAL_MS = 1500`, `HARD_CEILING_MS = 90_000`). We do NOT break on the first `allComplete: true` alone — CraftCloud will occasionally flip it true with an empty array on cached library modelIds, or while late vendors are still responding. Additional exit conditions: 3 consecutive 4xx responses = stale priceId bail (mobile tab backgrounded); 4 consecutive network errors = timeout; `"timeout"` exit reason → partial-results UI. Logic lives in `components/print/poll-quotes.ts` (shared by the quote configurator and cart re-pricing at `cart-context.tsx:234`).

**Idempotency** — the anon checkout chain (R2 → draft → order → Stripe) uses a `checkoutInFlightRef` to prevent double-fire (`quote-configurator.tsx:357`, set/cleared `:868-962`). The Stripe webhook checks `order.craftCloudOrderId` in addition to `order.status` so a retry after a partial commit doesn't re-place the CraftCloud order.

**Local Stripe webhook forwarding** — the order only advances from `cart_created` → `ordered` when `/api/webhooks/stripe` runs `handlePrintOrderPayment`. In local dev, Stripe can't reach `localhost:3000` on its own, so run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` in a side terminal during checkout testing. Without it, the order sits in the profile's "Carts" section with a Resume button that just relinks to the same Stripe session — easy to mistake for "payment didn't go through." The `STRIPE_WEBHOOK_SECRET` for local dev is the value the `stripe listen` command prints on startup, not the one from the Stripe dashboard.

**Sandbox indicator** — when Stripe is on test keys (`sk_test_*`) or `CRAFTCLOUD_USE_MOCK !== "false"` (the default), an amber "Sandbox" pill renders in the nav (sidebar at nav+, header at sub-nav). Detection lives in `isSandboxMode()` in `lib/env.ts`. If you add another mock/test gate, OR it into that helper so the badge keeps reflecting reality.

**Stripe redirect URL** — `createStripeSessionForOrder` derives the `success_url` / `cancel_url` base from request headers (`x-forwarded-host` + `x-forwarded-proto`), NOT from `NEXT_PUBLIC_APP_URL`. The env var bakes at build time; when unset in production it falls back to `http://localhost:3000` and the hardcoded localhost lands in every customer's post-payment redirect. The `tokens/page.tsx` MCP URL uses the same header-derived pattern for the same reason. Don't reintroduce `NEXT_PUBLIC_APP_URL` for runtime URL construction.

### Two-checkout flow (`CHECKOUT_MODEL=two_step`, CON-118)

Alternative checkout where the customer pays CraftCloud directly for production + shipping and we only ever touch our 3% fee. Gated by `CHECKOUT_MODEL` (read via `getCheckoutModel()` in `lib/env.ts`; default `single`). The env var only decides the model for NEW orders — every in-flight order branches on the persisted `printOrders.checkoutModel` column, so flipping the env never strands an order mid-flow.

```
completePrintOrder: places the CraftCloud order UNPAID up-front
                    + creates the CraftCloud-hosted bridge (payment) session
→ our Stripe Checkout authorizes the 3% fee ONLY (capture_method: manual)
→ webhook advances cart_created → awaiting_production_payment
→ customer pays CraftCloud at /orders/[id]/pay-production (interstitial → CraftCloud-hosted page)
→ hourly cron reconcile-production-payments polls getOrderStatus:
    paid      → capture the fee hold, notifyPrintOrderPlaced, → ordered
    abandoned → after 72h, CANCEL the hold (Stripe auths die at ~7 days regardless)
```

Gotchas:

- **`payment_status: "unpaid"` is success** — a completed manual-capture session reports `payment_status: "unpaid"` (the fee is held, not charged). The webhook router special-cases two_step for exactly this; don't "fix" it back to requiring `paid`.
- **Money invariant** — under two_step we never hold customer money for an unplaced order. Abandonment = cancel the authorization, not refund. If you find yourself writing a refund path for `awaiting_production_payment`, you've taken a wrong turn.
- **`isProductionPaymentConfirmed`** (`lib/craftcloud/payment-confirmation.ts`) is how the cron decides CraftCloud got paid. It's built on an UNVERIFIED assumption about CraftCloud's order-status payload (CON-118 open question #2) and is the designated swap point once the real signal is confirmed — change it there, not in the cron.
- **`notifyPrintOrderPlaced` fires at capture time** under two_step (when the cron confirms CraftCloud payment), NOT when the customer pays our fee checkout.
- **UI surfaces** — `awaiting_production_payment` rows sit in the profile "Carts" section with a "Complete payment" button (same `resumePrintOrder`, returns the CraftCloud payment URL, or an error when the fee authorization expired); the pre-checkout "you'll see two charges" disclosure in `price-display.tsx` is driven by a `checkoutModel` prop threaded from the server pages (`getCheckoutModel()` is server-only — `import type { CheckoutModel }` is fine in client components, the value is not).
- **Upgrade path** — if the CraftCloud partner/reseller agreement lands (CON-116 path 2), `CHECKOUT_MODEL` flips back to `single` and the original single-checkout architecture (fully preserved) takes over; two_step stays as the fallback.

### Anon OTP sign-up at checkout

The revenue shortcut. Anon users walk the full quote flow, then enter email on the shipping form. Inside `ShippingAddressForm`, we run `signUp.create({ emailAddress })` + `prepareEmailAddressVerification` inline, show the OTP step, `attemptEmailAddressVerification` + `setActive`, then `setUsernameFromEmail` (best-effort), then call the parent's `onSubmit` with the stashed address payload. If the email already exists we pivot to `signIn` email-code instead. All in one form, no modal.

### Agent-initiated orders (MCP) — CON-152

Agents call the `place_print_order` MCP tool. Every order lands `awaiting_agent_approval` first (`lib/mcp/internal/orders.ts:259`) and only promotes to `auto_approved` if three conditions hold: the global kill switch is on + the spending policy approves + the off-session charge succeeds (`orders.ts:298-361`). Every `false` policy outcome falls through to confirm-by-email — it never hard-fails (`lib/billing/policy.ts:69-74`). `fallbackReason` is set on any downgrade.

Key gotchas:

- **Kill switch** — `MATERIALIZE_AGENT_BILLING_ENABLED === "true"` gates the entire auto path (`orders.ts:32-34`). Default OFF. Deploying this code without the flag is a safe no-op.
- **Confirmation tokens** — 24h TTL (`CONFIRMATION_TTL_MS`, `orders.ts:24`; enforced `app/actions/agent-orders.ts:78-83`). The confirm action sets a `session_claim:<nanoid>` sentinel in `stripeSessionId` to claim the row atomically, then mints the Stripe session; on Stripe failure it rolls back to `awaiting_agent_approval` (`:120`/`:133`).
- **Cancellation window** — `DEFAULT_CANCELLATION_WINDOW_MINUTES = 5` (`lib/billing/policy.ts:50`) is a **default**. Per-policy `cancellationWindowMinutes` overrides it; `0` disables the window entirely. The placement cron runs every minute, so actual placement time = window + ≤1 min. Do NOT write "always 5 minutes."
- **Budget windows** — UTC midnight / ISO-Monday UTC / first-of-month UTC (`computePeriodStart`, `policy.ts:180-195`). Deliberately server-UTC — "tomorrow" means tomorrow on the server, not in the user's local timezone.
- **Off-session PI** — created at `orders.ts:311-332`, idempotency key `agent-charge:<idempotencyKey>`. The PaymentIntent id is stored in the **reused `stripeSessionId` column** (`:353`) — the same column that holds Stripe Checkout session ids and `session_claim:` sentinels. Never call `stripe.checkout.sessions.retrieve(stripeSessionId)` without checking the prefix.
- **`awaiting_agent_approval` vs `awaiting_production_payment`** — agent order pending email confirm vs two-step order pending CraftCloud payment. Different flows, different actors, different resolution paths.
- **Known races** — CON-77 (budget read-then-write race allows overspend); CON-81 (auto-approve charge + ledger insert aren't atomic). Do not work around these races without reading those issues first.

## Print order status machine — CON-153

12-state `printOrderStatusEnum`. Transitions are enforced only by scattered code — this is the canonical map.

**Entry points:**
- ∅ → `cart_created`: user checkout (`lib/print/print.ts:211` / `:357`)
- ∅ → `awaiting_agent_approval`: MCP order (`lib/mcp/internal/orders.ts:259`)

**Transitions:**
```
awaiting_agent_approval → auto_approved          (off-session PI ok, orders.ts:351)
                        → cart_created           (email confirm, agent-orders.ts:93;
                                                  rolls back on Stripe-mint failure :120/:133)
auto_approved           → cart_created           (minutely cron, place-auto-approved-orders/route.ts:58)
                        → cancelled              (user cancel link, refund+ledger delete, agent-orders.ts:367)
cart_created            → ordered                (webhook claim-place, handle-print-order-payment.ts:165, heal :125)
                        → awaiting_production_payment  (two-step fee auth, :209)
                        → cancelled              (daily cleanup >48h stale, cleanup-stale-orders/route.ts:71)
awaiting_production_payment → ordered            (hourly reconcile capture, reconcile-production-payments.ts:167 / heal :132)
                            → cancelled          (PI canceled or >72h, :116 / :209)
ordered                 → in_production|shipped|received|blocked|cancelled
                                                 (checkOrderStatus, print.ts:255-277 —
                                                  ZERO production callers; see CON-107)
blocked|ordered         → refunded               (print.ts:1389)
```

**Truths every consumer must know:**

- **`quoting` is dead** — it's the column default only; no writer ever sets it, no code reads it. Ignore it.
- **Orders sit at `ordered` forever** — `checkOrderStatus` (the only path past `ordered`) has zero callers in production. CON-107 tracks adding fulfillment sync. Do NOT document or assume post-`ordered` states are reachable today; the only live path past `ordered` is inside `requestOrderRefund` (`:1335-1347`).
- **Three status-writing crons**: `place-auto-approved-orders` (minutely), `reconcile-production-payments` (hourly), `cleanup-stale-orders` (daily). `retry-failed-refunds` does NOT write status.

**Consumer checklist** — every place that branches on `printOrderStatus` must be updated when states are added:
- `app/(app)/dashboard/orders/[orderId]/page.tsx:23-33` — status label/variant map (note: duplicate map in orders-tab; both currently missing `awaiting_agent_approval`/`auto_approved` labels — CON-114)
- `components/print/order-status-tracker.tsx` — STEPS array
- `components/files/file-activity.tsx:38-40` — activity display
- `lib/mcp/internal/orders.ts:423-427` — TERMINAL_STATUSES + raw passthrough
- `app/api/[transport]/route.ts:1181-1205` — MCP tool response shaping
- `lib/mcp/email.ts:103` — agent notification emails
- `app/actions/files.ts:623-628` — ACTIVE_ORDER_STATUSES gate
- `/orders/[id]/confirm`, `/orders/[id]/cancel`, `/orders/[id]/pay-production` — status gates on those pages
- `app/llms.txt/route.ts:48` — LLM-facing status list
- `lib/print-statuses.ts` — PRINTED_STATUSES (consumers: `lib/entitlement.ts:278,297`, `earnings-tab.tsx:183,201`, `files/[slug]/page.tsx:395,439`)

## Server action vs API route

- **Server actions** (`app/actions/*`) for anything that mutates the DB and is called from a client component with `useTransition` or a form submit. Easier to revalidate paths / tags.
- **API routes** (`app/api/**/route.ts`) for cross-origin webhooks (Stripe), signed-URL flows, anything the client needs to `fetch()` directly, and anything called by external services.
- CraftCloud quote start + poll is split into two routes (`app/api/craftcloud/quotes/route.ts` + `app/api/craftcloud/quotes/poll/route.ts`) because the polling loop lives on the client — keep it that way, do not hide a long-lived polling loop behind a server action.

## Material catalog gotcha

There are **two** material sources and they do NOT share ids:

- `lib/materials/` — our curated display catalog (PLA White, PLA Black, Titanium Grade 5, …) used for filter chips, material landing pages, listing recommendations, and the home hero carousel (`HERO_MATERIALS`).
- `lib/craftcloud/catalog.ts` — CraftCloud's upstream catalog (materials, finish groups, configs, vendors, providers). 24h-cached. Every id here is a CraftCloud UUID.

`MaterialPicker.preselectMaterialId` expects a **CraftCloud** id. `/materials/[slug]` pulls from the CraftCloud catalog (not lib/materials), so the "Print with X" link passes the right kind of id already. Any new consumer of `preselectMaterialId` must do the same — local lib/materials ids will silently no-op.

## Categories — CON-165

`lib/categories/index.ts` — curated browse taxonomy (flat, ~21 slugs). Plain-text slugs stored on `files`, `projects`, and `collections` (indexed `category` columns). Validation is app-layer via `isCategoryId` / the Zod helper exported from the same file — an unknown slug from a stale client is rejected on write and silently dropped on read (e.g. invalid `?category=` on `/files`). `keywords` feed search: a query matching a category's label, id, or keywords surfaces every item in that category (`categoryIdsMatchingQuery`), so "drone" or "gps" pulls the Hobby & RC shelf even when no item spells it out. Category filter chips: `components/files/category-filter-bar.tsx`.

## Data model gotchas — CON-154

### files vs fileAssets

`fileAssets.fileId → files.id` (cascade, **nullable until linked**, `lib/db/schema.ts:448`). They are not the same thing:

- `files` — owns listing metadata: name, slug, status, price, license, category, `recommendedMaterialId` (editorial slug), `recommendedCcMaterialId` (CraftCloud UUID).
- `fileAssets` — owns the artifact: `storageKey`, `format`, `geometryData`, `craftCloudModelId`, hashes.

### printOrders.material stores a CraftCloud config UUID

`printOrders.material` (`lib/db/schema.ts:591`) stores the **CraftCloud config UUID**, not a slug. There is **no** `materialConfigId` column on `printOrders`. The real `materialConfigId` columns live on `printOrderItems` (`:722`) and `cartItems` (`:750`). The slug/UUID duality for display-catalog recommendations lives on `files`: `recommendedMaterialId` (editorial slug) vs `recommendedCcMaterialId` (CraftCloud UUID) (`:269-270`).

### Three-tier cart

`components/print/cart-context.tsx` manages three tiers:
1. **`localItems`** — anon in-memory raw `File`s, materialized via `materializeLocalItems()` (`:298-392`: presign → R2 → draft file → addToCart, per-item dequeue).
2. **DB `cartItems`** — a Materialize cart row; this is what "Add to Cart" writes.
3. **CraftCloud cart** — created only at checkout, per vendor group (`createCart()` in `lib/print/print.ts:171`, called from `checkoutVendorGroup` → `orders.ts:173`).

Never call the DB cart a "CraftCloud cart." They are distinct: the DB cart is a pre-checkout staging area; the CraftCloud cart is ephemeral and created during checkout.

### Notifications

`notifications.type` is free-form text (`lib/db/schema.ts:951`) — not a Postgres enum, so new types don't need a migration. Known types are in `lib/notifications/types.ts`. Master email switch: `users.emailNotificationsEnabled`; per-type opt-out: `users.emailNotificationPrefs` (jsonb, `:221-227`). `purchase_on_listing` and `refund_on_listing` are not opt-out-able. Reader: `lib/notifications/email-prefs.ts:31`.

## Implicit contracts — CON-165

**Overloaded sentinel columns** — `printOrders.stripeSessionId` holds one of: a Stripe Checkout session id, a PaymentIntent id (auto-approved path, `lib/mcp/internal/orders.ts:353`), or a `session_claim:<nanoid>` sentinel (`app/actions/agent-orders.ts:20,88`). `printOrders.craftCloudOrderId` holds one of: a real CraftCloud order id, or a `placing:<nanoid>` sentinel (`app/api/webhooks/stripe/handle-print-order-payment.ts:56-60`). Never call `stripe.checkout.sessions.retrieve(stripeSessionId)` or treat `craftCloudOrderId` as a real id without checking prefixes first.

**`withDbRetry` is read-only by contract** (`lib/db/retry.ts:15-17`) — it is intended only for idempotent SELECT loaders. Wrapping a write risks double-applying it on a retry. This contract is stated in the file's header comment and must not be relaxed without a careful audit.

**Double-fire guards live in the callers** — `checkoutInFlightRef` at `components/print/quote-configurator.tsx:357` (set/cleared `:868-962`) guards the anon checkout chain; `materializingRef` at `components/print/cart-context.tsx:109` guards cart materialization. Moving or extracting the chained functions does NOT move the guards — they must travel with the call site.

## Fonts

- **Body** — system font stack (`-apple-system, SF Pro, …`), set in `app/globals.css` via `--font-sans`. No webfont download.
- **Hero display** — local OTFs in `public/`: `PPFuji-Bold.otf` as `--font-display` and `PPPlayground-Light.otf` as `--font-script`. Loaded via `next/font/local` in `app/layout.tsx`. Applied via inline `fontFamily: "var(--font-display)…"` on the home hero `<h1>` ("Materialize" display + "Anything" script) and the nav brand link. The hero heading is real selectable text, not an SVG — it must stay an `<h1>` so the home page (the URL every backlink points at) ships a crawlable heading.

## Testing

- `vitest` with the setup at `vitest.setup.ts` that pre-mocks `@clerk/nextjs/server`, `next/cache`, `next/navigation`, and `server-only`. New tests don't need to re-mock these.
- Tests co-located under `__tests__` siblings to the code they cover.
- Server actions are tested by mocking `@/lib/db`, `@/lib/storage`, and `@/lib/logger` — see `app/actions/__tests__/files.test.ts` for the pattern.
- Before adding a runtime assertion or refactor, check whether the existing test suite already covers the contract. Run `npx vitest run` before committing.
- **Pre-commit gate is `npm run build`, not filtered `tsc`**. `tsconfig.json` includes `**/*.ts` (scripts/, tests, everything), and Next's build pass is the only place the full program is type-checked for real. Never gate commits on `tsc --noEmit | grep <file>` — grep-filtered output hides errors in files you didn't touch this turn, and Vercel is then the first unfiltered pass. Seen once: `scripts/seed-resume-test.ts` shipped with a bad `users` column reference because the grep filter hid it from the local sanity check.

## Common pitfalls

- **Clerk session cookie lag**: a server action called immediately after `await setActive()` may still see `userId: null`. When chaining, prefer the OTP-in-form pattern in `ShippingAddressForm` which stashes the payload and lets the Clerk client finish before the parent runs the server actions.
- **iOS keyboard push**: the home bottom bar uses the VisualViewport API to reposition above the keyboard; `app/layout.tsx` exports `viewport.interactiveWidget = "overlays-content"`. Don't regress this.
