<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## What this project is

Materialize is a 3D-print marketplace + instant-quote flow. Users upload models, browse/purchase files from other creators, and order physical prints through third-party manufacturers (CraftCloud). Revenue comes from a 3% service fee on print orders.

## Working with Linear (required)

Work on this repo is tracked in the **Materialize** Linear team (key `MTR`, workspace `connorwhite`). This is not optional bookkeeping — it is how the roadmap stays legible. Every non-trivial change maps to an issue, and you keep that issue's status honest as you work.

**Before you start coding:**

1. **Find or file the issue.** Search MTR first (`list_issues`, team `Materialize`). If nothing covers the work, create one in the right project before starting — title = the outcome, body = enough for a cold executor (file:line pointers, acceptance criteria). Don't do untracked work.
2. **Claim it.** Move it to **In Progress** and assign yourself when you begin. States: `Backlog` → `Todo` → `In Progress` → `Done` (plus `Canceled`, `Duplicate`).
3. **Keep status honest.** Update as you go; don't leave merged work in In Progress, and don't mark `Done` until it's merged/verified.
4. **Link the PR.** Put `MTR-###` in the PR title or body so Linear links the branch/PR automatically (the issue's suggested `connorwhitestudio/mtr-###-…` branch name does this for free).
5. **Right project + label.** File into the feature/cross-cutting project it belongs to, and tag the concern label(s).

**Projects** (what we're building):

- **Print Quote Pipeline** · **Checkout, Payments & Order Lifecycle** · **Agent Orders & MCP** · **Text-to-CAD Studio** · **Marketplace: Listings, Purchases & Disputes** · **Creator Tools: Projects, Collections & Build Guides** · **Accounts, Profiles & Orgs** · **3D Viewer & Rendering** (product areas)
- **Testing & E2E** · **Observability & Ops** · **Platform: Infra, DevX & Environment** (cross-cutting)
- **📋 Overview & Ways of Working** holds no issues — it's the workspace map + the human copy of these rules.

**Labels** = cross-cutting concerns that span projects: `Bug`, `Improvement`, `Feature`, `DX`, `Observability`, `Accessibility`, `Performance`, `Security`, and `Needs Decision` (maintainer must weigh in — pair it with a `🔵 OPEN QUESTION` comment listing options + a recommendation; don't block on it).

**Legacy `CON-###`:** issue numbers in code comments and older descriptions (`CON-107`, `CON-153`, …) are from the pre-MTR `connorwhite`/`CON` team. They are historical context and do **not** resolve 1:1 to current `MTR-###` issues — don't chase them as live links.

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

**Idempotency** — the anon checkout chain (R2 → draft → order → Stripe) uses a `checkoutInFlightRef` to prevent double-fire (`quote-configurator.tsx:364`, set/cleared `:875-969`). The Stripe webhook checks `order.craftCloudOrderId` in addition to `order.status` so a retry after a partial commit doesn't re-place the CraftCloud order.

**Local Stripe webhook forwarding** — the order only advances from `cart_created` → `ordered` when `/api/webhooks/stripe` runs `handlePrintOrderPayment`. In local dev, Stripe can't reach `localhost:3000` on its own, so run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` in a side terminal during checkout testing. Without it, the order sits in the profile's "Carts" section with a Resume button that just relinks to the same Stripe session — easy to mistake for "payment didn't go through." The `STRIPE_WEBHOOK_SECRET` for local dev is the value the `stripe listen` command prints on startup, not the one from the Stripe dashboard.

**Sandbox indicator** — when Stripe is on test keys (`sk_test_*`) or `CRAFTCLOUD_USE_MOCK !== "false"` (the default), an amber "Sandbox" pill renders on the **checkout surfaces only**: beside "Order Summary" in `price-display.tsx` and beside the "Cart" title in `cart-panel.tsx`. It used to sit in the nav on every page; it earns its space at the moment money is supposed to move, not before. Detection still lives in `isSandboxMode()` (`lib/env.ts`, server-only) — `AppShell` reads it once and hands it to the tree through `SandboxProvider`, and client surfaces read it with `useSandbox()` (`components/sandbox-context.tsx`). `useSandbox()` defaults to `false` with no provider, so a surface rendered in isolation degrades to "live" rather than crying sandbox at a real customer. If you add another mock/test gate, OR it into `isSandboxMode()` so the badge keeps reflecting reality; if you add another surface that takes payment, give it the chip.

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
- ∅ → `cart_created`: user checkout (`app/actions/print.ts:283` / `:461`)
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
                                                 (checkOrderStatus, app/actions/print.ts:317-367 —
                                                  ZERO production callers; see CON-107)
blocked|ordered         → refunded               (app/actions/print.ts:1587)
```

**Truths every consumer must know:**

- **`quoting` is dead** — it's the column default only; no writer ever sets it, no code reads it. Ignore it.
- **Orders sit at `ordered` forever** — `checkOrderStatus` (the only path past `ordered`) has zero callers in production. CON-107 tracks adding fulfillment sync. Do NOT document or assume post-`ordered` states are reachable today; the only live path past `ordered` is inside `requestOrderRefund` (`:1335-1347`).
- **Three status-writing crons**: `place-auto-approved-orders` (minutely), `reconcile-production-payments` (hourly), `cleanup-stale-orders` (daily). `retry-failed-refunds` does NOT write status.

**Consumer checklist** — every place that branches on `printOrderStatus` must be updated when states are added:
- `app/(app)/dashboard/orders/[orderId]/page.tsx:23-33` — status label/variant map (note: duplicate map in orders-tab; both now carry `awaiting_agent_approval`/`auto_approved` labels as of CON-114 — only the map *duplication* itself remains to consolidate)
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

`fileAssets.fileId → files.id` (cascade, **nullable until linked**, `lib/db/schema.ts` § `fileAssets.fileId`, line 508). They are not the same thing:

- `files` — owns listing metadata: name, slug, status, price, license, category, `recommendedMaterialId` (editorial slug), `recommendedCcMaterialId` (CraftCloud UUID).
- `fileAssets` — owns the artifact: `storageKey`, `format`, `geometryData`, `craftCloudModelId`, hashes.

### printOrders.material stores a CraftCloud config UUID

`printOrders.material` (`lib/db/schema.ts` § `printOrders.material`, line 702) stores the **CraftCloud config UUID**, not a slug. There is **no** `materialConfigId` column on `printOrders`. The real `materialConfigId` columns live on `printOrderItems` (§ `printOrderItems.materialConfigId`, line 833) and `cartItems` (§ `cartItems.materialConfigId`, line 867). The slug/UUID duality for display-catalog recommendations lives on `files`: `recommendedMaterialId` (editorial slug) vs `recommendedCcMaterialId` (CraftCloud UUID) (§ `files.recommendedMaterialId`/`recommendedCcMaterialId`, lines 290-291).

### Three-tier cart

`components/print/cart-context.tsx` manages three tiers:
1. **`localItems`** — anon in-memory raw `File`s, materialized via `materializeLocalItems()` (`:298-392`: presign → R2 → draft file → addToCart, per-item dequeue).
2. **DB `cartItems`** — a Materialize cart row; this is what "Add to Cart" writes.
3. **CraftCloud cart** — created only at checkout, per vendor group (`createCart()` in `lib/craftcloud/client.ts:254`, called from `checkoutVendorGroup` in `app/actions/print.ts:377` (cart created at `:417`)).

Never call the DB cart a "CraftCloud cart." They are distinct: the DB cart is a pre-checkout staging area; the CraftCloud cart is ephemeral and created during checkout.

### Notifications

`notifications.type` is free-form text (`lib/db/schema.ts` § `notifications.type`, line 1079) — not a Postgres enum, so new types don't need a migration. Known types are in `lib/notifications/types.ts`. Master email switch: `users.emailNotificationsEnabled`; per-type opt-out: `users.emailNotificationPrefs` (jsonb, `:221-227`). `purchase_on_listing` and `refund_on_listing` are not opt-out-able. Reader: `lib/notifications/email-prefs.ts:31`.

## Implicit contracts — CON-165

**Overloaded sentinel columns** — `printOrders.stripeSessionId` holds one of: a Stripe Checkout session id, a PaymentIntent id (auto-approved path, `lib/mcp/internal/orders.ts:353`), or a `session_claim:<nanoid>` sentinel (`app/actions/agent-orders.ts:20,88`). `printOrders.craftCloudOrderId` holds one of: a real CraftCloud order id, or a `placing:<nanoid>` sentinel (`app/api/webhooks/stripe/handle-print-order-payment.ts:56-60`). Never call `stripe.checkout.sessions.retrieve(stripeSessionId)` or treat `craftCloudOrderId` as a real id without checking prefixes first.

**`withDbRetry` is read-only by contract** (`lib/db/retry.ts:15-17`) — it is intended only for idempotent SELECT loaders. Wrapping a write risks double-applying it on a retry. This contract is stated in the file's header comment and must not be relaxed without a careful audit.

**Double-fire guards live in the callers** — `checkoutInFlightRef` at `components/print/quote-configurator.tsx:364` (set/cleared `:875-969`) guards the anon checkout chain; `materializingRef` at `components/print/cart-context.tsx:109` guards cart materialization. Moving or extracting the chained functions does NOT move the guards — they must travel with the call site.

## Brand logo

Three components in `components/brand/logo.tsx`, all painting with
`fill="currentColor"` so they follow the surrounding `text-*` token in both themes:

- **`<Logomark>`** — the "M" alone. Use where there's no horizontal room: the
  landing header below `nav` (where it stands in for the word), the mobile nav's
  collapsed pill on `/` (no title beside it), the fee-sheet tile.
- **`<Wordmark>`** — the full word, static.
- **`<AnimatedWordmark>`** — the same word with a CSS-only reveal: the "M" is
  always painted and the other ten letters drift in left-to-right, each blurred
  and lifted, settling as a bottom-to-top wipe fills it in. `animateOnMount`
  plays it once (keyframes — works with JS disabled); `expanded` makes it a
  controlled toggle between the word and the bare mark, which reverses the
  stagger so it peels right-to-left back to the "M". Collapse crops the word
  and scales **only the mark** (`.mz-logo-mark` via `--mz-mark-scale` in
  `globals.css`) so the logo.svg "M" finishes taller than the word was — do
  **not** scale the wordmark SVG itself or the remaining letters grow as they
  peel. Mount-mode stays crop-only.

  **The lockup is two numbers that only mean anything together**: the height
  the word wipes in at, and the scale that lands the collapsed mark.
  Currently **10px word → 16px mark** (`NAV_WORDMARK_HEIGHT` in
  `top-bar.tsx` and `PILL_WORDMARK_HEIGHT` in `mobile-nav.tsx`, both paired
  with `--mz-mark-scale: 1.6`). Change one and you must change the other.
  This has gone wrong once already: the lockup was tuned to 11px × 1.45, then
  a commit raised the height to 22px because the *static* mark shared the same
  constant — silently doubling the collapsed M to 32px. `NAV_LOGO_HEIGHT` (22px,
  app chrome, does not collapse) is deliberately a separate constant now, and
  a test in `components/nav/__tests__/top-bar.test.tsx` pins the product of the
  pair rather than either number.

  Live on **both** navs, driven by the same `useWordmarkExpanded()`
  (`lib/hooks/`) so they can't drift: the landing header at `nav+` (vertically
  centered on the 40px search row) and the **anon** home pill in `<MobileNav>`
  below it. `animateOnMount` until the first scroll, then `expanded` tracks
  scroll. The hook returns `undefined` before the first scroll on purpose —
  that unset value is what keeps `AnimatedWordmark` in mount mode; hand it a
  boolean from the start and the wipe-in never plays. Signed-in home keeps the
  bare `<Logomark>` — that pill sits over a dashboard, not a hero. Also
  `<Logomark>` on the auth modal, `/sign-in`, `/sign-up`, `/onboarding`, and
  app chrome (22px, no collapse).

All geometry lives in `components/brand/logo-paths.ts` — **the only place path
data is defined**. Updating the logo means replacing the `d` strings there (one
path per wordmark letter, in reading order, "m" at index 0 — the animation
depends on that ordering) and re-exporting `app/icon.svg`, the one intentional
duplicate. A test pins `app/icon.svg` to `MARK_PATH` so the favicon can't drift.

Motion and sizing live in `app/globals.css` (`.mz-logo*`), not in the component,
so timing can be retuned without touching TSX. **Timing is measured, not
eyeballed** — the current values came from a 60fps device capture cross-checked
against a rAF harness driving the same rules in Chromium (the two agreed to
~30ms). Today: the word's width settles at ~170ms and the last letter lands at
~340ms; the peel clears at ~420ms. The reveal used to run
~714ms and read as sluggish, almost entirely because nine letters of 38ms
stagger burned 342ms before the last one started — `--mz-stagger-in` is the
first lever to reach for, not `--mz-letter-ms`. Note the asymmetry is
deliberate: a letter you are waiting to arrive reads slower than one you are
watching leave, so the collapse tolerates a longer stagger than the reveal.
The re-measuring recipe is in the CSS comment. Sizing flows from a single
`--mz-h`; the component writes it inline **only when a `height` prop is passed**,
because inline styles outrank stylesheet rules and would otherwise defeat the
responsive `[--mz-h:15px] sm:[--mz-h:20px]` class escape hatch. Nothing animates
on the main thread — the stagger is `transition-delay`/`animation-delay` off a
per-letter `--mz-i`, and `prefers-reduced-motion` collapses it to instant.

## Fonts

- **Body & headings** — one system font stack (`-apple-system, SF Pro, …`), set in `app/globals.css` via `--font-sans`. Headings inherit it (sizes/weights unchanged). No webfont download. `--font-heading` aliases `--font-sans` so leftover `font-heading` utilities still resolve.
- **Display** — `PPFuji-Bold.otf` (`--font-display`) is **not loaded in the browser.** It set the old home-hero wordmark; the brand is an SVG now (§ Brand logo). `lib/og/render-card.tsx` still reads the same OTF off disk for OG cards — server-side, unaffected. The file stays in `public/`.
- **`PPFrama-Regular.otf`** is on disk but **not loaded.** It used to be `--font-heading`. To bring it back, declare it with `next/font/local` in `app/layout.tsx` and point `--font-heading` at that variable.
- **`PPPlayground-Light.otf` (`--font-script`) is currently unused.** It set the "Anything" word in the old wordmark hero; that hero is gone and the 157KB OTF preload went with it. The file is still in `public/` — if you reintroduce it, declare it in the route that uses it (not `app/layout.tsx`) so it doesn't load site-wide.
- The home hero heading is real selectable text, not an SVG — it must stay an `<h1>` so the home page (the URL every backlink points at) ships a crawlable heading. It states what the product does; the brand mark lives in the header `<Logomark />` instead, so "Materialize" still appears above the fold.

## Mobile navigation

Sub-`nav` viewports (< 67.5rem) get `components/nav/mobile-nav.tsx` instead of the desktop `TopBar` — a single floating surface that morphs:

- The card wears **`.glass-surface`** (`app/globals.css`), the same frosted fill as dialogs and popovers — `--popover-translucent` plus blur + saturate, with a solid `--popover` fallback where `backdrop-filter` is unsupported. It replaced a hand-rolled `bg-background/85 backdrop-blur-2xl` that was a near-miss of the same treatment. `.glass-surface` is in `@layer components`, so **any `bg-*` utility beside it silently wins** and the card goes opaque — a test pins this.
- **Collapsed** it is a pill: the current page's icon, the page title, and a grabber (two chevrons, open ends facing — `components/icons/grabber.tsx`). The unread pip is a `bg-destructive` dot straddling the pill's top-right edge — it hangs off a `relative` wrapper *outside* the card, because the card is `overflow-hidden` (the height animation needs that) and would clip it. The Notifications row's count chip wears the same red, so "unread" is one colour wherever you meet it; the cart count stays neutral. The grabber reads the same open or closed, so unlike a lone chevron it doesn't rotate. No sandbox chip — that moved to the checkout surfaces (§ Print quote pipeline).
- **`/` is mark-only**: the pill drops the title (`markOnly` on the resolved identity) and skips the min-width floor so it shrinks to fit. Anon gets the full `<AnimatedWordmark>` there rather than the bare `<Logomark>` — same wipe-in and scroll-collapse as the desktop nav (§ Brand logo). The pill's width therefore has to move with the lockup, and the way it does that is load-bearing. The measuring ghost (`useNavWidths`) holds a real lockup, but `mz-nav-ghost` **freezes** it (`transition/animation: none !important`, `app/globals.css`) so it reports the final width immediately. The card then runs exactly **one** width tween, `CARD_CROP`, whose duration and easing mirror `--mz-crop-ms` and `--ease-out-soft`. That pairing is the whole trick: the pill's width is the lockup's width plus constant padding, so identical duration + curve makes them the same animation and the word can never outrun its container. Let the ghost animate instead and the card chases a moving target — measured on device, the pill ran ~65px narrower than its own content for ~230ms mid-reveal, clipping the word against its right edge, then nudged wider again 200ms after the word had settled. If you retune `--mz-crop-ms`, retune `CARD_CROP` with it; a test pins them together. Keep both within ~20ms of `CARD_OUT`, which still drives the menu's height close, or the card's width and height visibly disagree when the menu shuts. The button still names itself "Home — open navigation menu" for assistive tech. Inversely, the **menu row** for Home is labelled, so it takes the house glyph (`components/icons/home.tsx`) — the logomark only ever stands alone.
- **On the viewer's own profile** the pill wears their avatar and `@handle` (truncated at 8.5rem) instead of a glyph and the word "Profile" — the page is them. `identity.label` still names the button for assistive tech.
- **Tapped** it widens and grows upward into a menu card — Home / Search (`/files`) / Print / Materials / Notifications, plus the owner-only Prometheus entry — with the desktop-style avatar + name/@username container taking over the pill's row at the bottom. Anon visitors get the same destinations minus Notifications, and a full-width secondary **Login** button (same as TopBar) in place of the avatar row — no inbox.

Two things to keep in mind when touching it:

- **Never put `layout` on the card.** Its width is animated as a number, between the expanded width (viewport-clamped) and a collapsed width measured off an invisible ghost copy of the row (`useNavWidths`). Motion's layout FLIP scale-transforms children across a size change, which visibly stretches the row's text — the same trap already documented on `HomeBottomBar`. Only the menu block animates `height: 0 ↔ auto`; the card's height follows it. The menu block is `flex flex-col justify-end` so shrinking height clips Home (the top) first; default top-alignment shears Materials into the identity row and reads as close-jitter.
- **Container lands first, content keeps arriving.** Opening, the card springs to full size in ~150ms while the rows keep resolving for another ~150ms behind it (38ms stagger — the wordmark's `--mz-stagger-in` — bottom row first, each row a short lift plus an 8px blur that sharpens as it lands). That gap is the whole effect: when container and content finish together the nav feels heavier than it is. The block animates height only — the rows own their fade and blur, so the card is never an empty box waiting for content. Closing, height springs immediately with width (same critically-damped close — do not delay it) while rows peel top → bottom (32ms stagger, delay baked into each row's `exit`). The pill identity must not swap until the card is nearly a pill; if it uses the open-path 50ms delay, "Search" prints over "Login" in a still-tall card. The close identity enter waits 180ms.
- **Retimes get filmed, not eyeballed.** Every number above came from stepping 60fps captures — a reference clip of Linear's nav, and our own via CDP `Page.screencast` (Playwright's screenshot loop is far too slow to see this). Two defects were invisible until filmed: rows squashing under a shrinking card, and a ~100ms empty-box flash on open.
- **Open state is derived, not an effect.** `openPath` stores the pathname the menu was opened on, so "collapse on navigate" and "collapse when the keyboard is up" fall out of `openPath === pathname && !keyboardOpen` rather than a `setState`-in-effect (which the React compiler lint rejects).

**Leaf pages get a back button that oozes out of the card's left edge.** A page with no row in the menu — a file, an order, someone else's profile, or a destination this viewer can't see (`/notifications` anon, `/prometheus` without the owner flag) — has no way out, so `isNavReachable()` is false there and a 44px chip grows leftward out of the card: width `0 → 44`, right corners `0 → 22px`, settling `BACK_GAP` (8px) clear of it. Three things about it are load-bearing:

- **It is absolutely positioned against the card's `relative` shrink-wrapper**, the same wrapper the unread pip hangs off, so it costs the card no layout and the pill never shifts. Do not make it a flex sibling.
- **Only the RIGHT corners animate**, `0 → BACK_SIZE / 2`; a square right edge reads as a slice of the card itself, and the rounding is the whole reason it looks like it detached rather than faded in beside it. `overflow-hidden` clips the glyph as the width grows instead of squashing it, and the glyph's own fade waits out the first third of the ooze. **The left pair is a static half-height set inline, NOT `rounded-l-full`**: Tailwind's `full` is an effectively infinite radius, and when the radii on one edge overrun the box CSS scales *every* corner by the same factor — so an infinite left pair crushed the animated right pair to ~0 and the button settled as a hard vertical cut. The computed style still reported `22px`, because that resolution happens at use time; only filming it showed the bug.
- **The fill comes from `NAV_SURFACE`**, one constant shared with the card (frosted `.glass-surface` + `ring-1 ring-border/70` + the lifted shadow). Two hand-copied class lists drift, and this one is supposed to read as a piece of the same glass. Same `bg-*`-beats-`@layer components` trap as before; a test pins the constant and both call sites.

It retracts while the menu is open — the menu is the way out then, and a chip floating beside a full-height card reads as a stray. Tapping pops history, falling through to `backFallbackHref()` (the destination the page sits under, `/files/<slug>` → `/files`) when there is nothing of ours in the stack, i.e. a cold deep link.

**Its timing is set against an otherwise instant navigation, and that is why it is not the card's curve.** Filming a route change frame by frame shows the page body swapping in **one** frame and the pill's title swapping in the same frame — and the pill's width never moves, because `MIN_COLLAPSED_WIDTH` floors both titles. The chip is the only thing on screen that animates, so it is the only thing the eye can catch trailing. It first shipped on the card's expo-out `[0.22, 1, 0.36, 1]` at 320ms and that was wrong twice over: the curve spends ~20% of the width in its **first frame**, so on device the chip appeared already detached, past half its final gap — the emergence, the entire point, never happened — and it then crept the last 28% over ~200ms while the new page sat fully rendered beside it. (The card's own comment warns about this asymptote for springs; an expo-out has it too.) Now `[0.4, 0, 0.2, 1]` at **180ms in / 130ms out**: ~2% of the width at 46ms means you actually see it flush against the card, and it lands at ~190ms instead of creeping to 250ms+. The glyph fades in over 100ms after a 60ms delay so it is solid *before* the chip stops growing — an empty white disc holding for the last frames reads as a missing icon. Tests pin the relationships (ooze ≤ `CARD_IN`, out < in, enter ease ≠ `CARD_IN`'s, glyph lands inside the ooze), not the raw numbers.

Retiming it means filming it: a rAF sampler reading `getBoundingClientRect()` on the chip is exact where pixel-sniffing a screencast is not, and both beat watching it.

Route/label resolution lives in `components/nav/mobile-nav-destinations.ts` (pure, unit-tested): `navDestinations()` builds the menu, `isDestinationActive()` is exact-match (a `/files/<slug>` detail page is not the Search listing), `resolvePageIdentity()` resolves the collapsed pill's icon + title, falling back through section prefixes so a detail page still names its section, and `isNavReachable()` / `backFallbackHref()` drive the back button above.

The inbox is a real page at `/notifications` (moved from `/dashboard/comments`, which now permanent-redirects) — desktop still reads it through the bell popover in the top bar, mobile navigates to it.

## Home landing page

`app/page.tsx` is the anon marketing page. Authed users get a home dashboard on the same URL (pending orders if any, upload dropzone, recent files if any, then the full library) instead of being sent to their profile. Anon chrome matches the rest of the app: `<TopBar />` at `nav+` (no `alwaysVisible`), the morphing `<MobileNav />` below that (Login button instead of the avatar row), then a full-viewport hero (heading + copy over the `home-v1-*` backgrounds — left-aligned with generous padding on desktop, below-center on mobile so it clears the light beam and the floating pill) and the server-rendered `<HomeMarketing />` / `<HomeFaq />`. The photo is `110dvh` and its last `20dvh` feathers from transparent to `--home-marketing`, giving the image 10% of runway beneath the browser chrome without a hard seam into the marketing content; copy remains `h-svh` inside the first visible screen. `--home-marketing` is an opaque `color-mix()` of `--muted` (20%) and `--background`, shared by the gradient endpoint and `<HomeMarketing />`; do not restore HomeMarketing's old `border-t bg-muted/20`, because that produces a visible horizontal join. The root `viewportFit: "cover"` frees the unsafe areas for the photo when the site is installed to the home screen — but **not in a Safari tab**, where the status-bar band and the wash under the toolbar are browser chrome no element of ours can paint into. Safari 26 fills them from the page under narrow rules: `background-color` **only** (a `background-image` is never read, however opaque it renders), off **`<body>`** (`<html>`'s is ignored), at **initial render** (JS cannot re-tint later). `<meta name="theme-color">` is ignored outright. **Leave `<body>` on `--background`.** Two fixes were tried and reverted, and the CSS comment in `app/globals.css` records both so they are not redone: a `fixed`/`sticky` sampler strip (a sticky one at its natural offset at scroll 0 was simply not picked up on an iPhone), and tinting `<body>` to the hero's top-edge colour — which *did* work, and that was the problem. Safari feeds **one** body colour to **both** bands, for the whole route, in every state, so matching the top of the photo mismatched the bottom band, the scrolled page, and everything behind the open nav menu and the auth modal; worst in dark mode, where it read as blue-grey strips framing a warm near-black UI. The seam is handled where it belongs instead: `<HeroBackground />` **feathers the top 12dvh of the art into `--background`** (mobile only via `md:hidden` — desktop has no band, so it would just mute the art), mirroring the 20dvh bottom feather into `--home-marketing`. Colour matching alone never killed the seam anyway: a photo arrives with detail, and cut-off detail is what the eye reads as an edge. Flat-to-flat in one colour has nothing to cut off. The owner's own `/${username}` page is profile/settings: the editable headline (avatar, name, handle, bio, socials) stays on screen, with General / Notifications / Agents / Payments tabs below. It is not the old library/orders dashboard.

The three.js / R3F hero showcase **is unmounted, not deleted.** `components/home/hero-showcase.tsx`, `hero-showcase-lazy.tsx`, `showcase-mesh.tsx`, `showcase-particles.tsx` and `material-carousel.tsx` are all still in the tree; `<HeroShowcase />` in the hero's visual slot restores it in one line. Anything that replaces it must (a) load through the `hero-showcase-lazy.tsx` `next/dynamic` + `ssr: false` wrapper so three.js stays off the critical path, and (b) reserve the canvas's height in the placeholder so its arrival doesn't shift the copy above it.

The home page also emits the site's only `Organization` / `WebSite` JSON-LD (both are `@id`-keyed singletons — do not repeat them on other routes) and the `FAQPage` node. FAQ copy lives in `lib/seo/home-faq.ts` and is read by both the JSON-LD and `<HomeFaq />`; never inline that copy in the component, because Google requires marked-up answers to appear verbatim on the page and two copies drift.

## Link previews (OG cards)

One renderer, `lib/og/render-card.tsx`, behind every `opengraph-image.tsx`. Two layouts:

- **`layout: "full"`** — the artwork owns all 1200×630. Chat clients and social cards already print the title and the domain beneath the image, so in-card text is duplicated chrome that costs two thirds of the frame. Used by `/files/[slug]` and `/materials/[slug]`.
- **`layout: "split"`** (default) — image tile + title/subtitle column. Still right for `/[handle]`, where the image is a circular avatar with no business being cropped to a 1.9:1 banner, and it is the automatic fallback whenever no image resolved — `shouldFullBleed()` degrades a `"full"` request rather than emitting a blank rectangle.

**Project cards have three shapes**, decided by `chooseProjectCard()` (`lib/og/project-card.ts`, unit-tested — the route gathers candidates, the helper picks between them): author-chosen **cover art** wins outright and goes full-bleed; **exactly one** bundled file gets that file's art full-bleed (a stack of one reads as a mistake); **two or more** fan their previews across the frame as a stack. Stack tile size is *derived from the count* (`stackGeometry()`), never fixed — a fixed size overflows at four tiles and clips exactly the art the stack exists to show. A test pins that every supported count fits inside 1200×630 including the bounding-box expansion rotation adds.

**`fit` is not cosmetic.** Materials are photographs → `cover`. Files are **transparent-background WebP canvas captures** of a model normalized to fill a square viewport (`components/viewer/thumbnail-capture.tsx`) → `contain`, or `cover` crops the part's extremities away. Contained still reads as full-bleed only because the capture's transparent background and the card's `#0a0a0a` are the same colour; change one and you must change the other.

**`files.thumbnailUrl` is relative and must be resolved before any server-side fetch.** It is stored as `/api/thumbnails/{fileId}` (plus a `?v=` cache-buster) — deliberately, because presigned R2 URLs cap at 7 days and next/image's optimizer won't follow redirects. Node's `fetch` rejects a relative URL outright, and `fetchImageDataUrl` swallowed the throw, so **file OG cards silently rendered the no-image placeholder from the day they shipped.** `resolveImageUrl()` (`lib/og/card-image.ts`) resolves against the live request host via `deriveAppUrl()` — not `NEXT_PUBLIC_APP_URL`, which bakes at build time (§ Print quote pipeline). It rejects protocol-relative `//host/path` **before** the leading-slash branch: `new URL("//evil.example/x", base)` inherits only the scheme and resolves to `evil.example`.

**Satori cannot decode WebP — and every file thumbnail is WebP.** The viewer captures `toDataURL("image/webp")`, satori rasterizes through resvg (PNG/JPEG/GIF only, plus native SVG), and handed the raw bytes it throws `u2 is not iterable` from deep inside the renderer, 500ing the route — a *broken* link preview rather than a plain one. So nothing reaches satori un-normalized: `toSatoriSafeDataUrl()` (`lib/og/card-image.ts`) runs every fetched or inline image through `sharp().metadata()`, passes the safe formats through untouched and transcodes the rest to PNG (bounded to 1200px). `sharp` is a **declared** dependency for this reason — it was previously only transitive via Next, and app code must not lean on that. The same function is why a non-image response can't 500 the route either: metadata() throws on HTML, so an SSO gate or error page degrades to the no-image card. Note this bug was *invisible* until the relative-URL fix above, because the fetch had never once succeeded — fixing one exposed the other.

Renders are pinned by `lib/og/__tests__/render-smoke.test.tsx`, which renders each layout end to end. Satori **silently ignores** CSS it doesn't support rather than erroring, so a layout it can't handle produces a card that renders and looks wrong — set `OG_SMOKE_OUT=<dir>` to dump the PNGs and actually look at them.

## Owner-chosen file previews

A file's thumbnail used to be shot once, automatically, head-on, the first time the owner opened `/files/[slug]` with no cached thumbnail (`FileThumbnailGenerator`). That one frame then represents the file on browse cards, library tiles, search, JSON-LD and the OG card. **Update preview** (`components/files/file-preview.tsx`, owner-only, rendered inside the viewer frame) re-shoots it from whatever angle the creator orbited to.

- **It re-renders offscreen, it does not screenshot the live canvas.** The live canvas is 4:3, carries UI chrome, and sets no `preserveDrawingBuffer`, so reading it back is only valid inside a synchronous render. Re-shooting through the existing `ThumbnailCapture` rig keeps every thumbnail in the product square, identically lit and identically normalized — the creator changes the angle, not the format.
- **Camera positions do not transfer between the two rigs.** The viewer renders at the model's native scale (millimetres, for an STL) inside drei's `<Stage adjustCamera>` at fov 45; the capture rig normalizes to a fixed world size at fov 40. What transfers is direction plus **framing** — the fraction of viewport height the model spans, which at fixed fov varies purely as the inverse of distance. All of it is in `components/viewer/preview-camera.ts`, unit-tested.
- **Framing is measured against the viewer's own settled fit**, recorded once by `PreviewFrameProbe` after the distance holds steady for a few frames (Stage's `<Bounds>` refit animates, so no single frame is trustworthy). That baseline is defined as equal to the capture rig's default framing, so pressing the button without touching the zoom reproduces exactly the automatic shot from your angle.
- **Do not measure the scene to get the model's size instead.** `<Stage>` defaults to `shadows="contact"`, so the graph carries a `ContactShadows` ground plane far larger than the part, and a bounding box over it reports the shadow catcher.
- **The light rig rotates with the camera.** The three-point rig is authored relative to the *viewer*, not the model; pinned to world axes, orbiting to the back of a part yields a silhouette.
- **The chosen angle is saved, and the viewer opens on it.** `POST /api/thumbnails` writes the camera into `files.previewDir{X,Y,Z}` + `previewFraming` in the *same* update as the thumbnail URL — a capture and the angle it was shot from are one fact. The detail viewer reads it back through `savedPreviewView()` and applies it once the automatic fit settles (the same `PreviewFrameProbe` the button depends on, since that settled distance is the baseline the saved framing is measured against). `viewerCameraPositionFor()` is the exact inverse of `previewViewFromOrbit()`, so an untouched zoom reopens at precisely the viewer's own fit, only rotated. **All four columns null is meaningful** — it means the thumbnail came from the automatic capture and the viewer should keep its default framing, so never backfill them.
- **The capture is not always WebP, and the route must not assume it is.** `canvas.toDataURL(type)` is specified to fall back to **PNG — silently, with no error and no signal** — for any type the browser cannot encode, and Safari decodes WebP but does not encode it. So every capture taken on iOS arrives as `data:image/png;base64,…`. `POST /api/thumbnails` accepts both prefixes, checks the magic bytes of the format the caller *declared* (so widening the allowlist doesn't widen the gate), and transcodes PNG to WebP with sharp before the R2 PUT — the key, the stored content type and every downstream consumer stay single-format. Requiring WebP 400'd every mobile capture: visible as "Couldn't update" on the button, and **invisible** for the automatic first capture, which only `console.warn`s, so an iPhone upload simply never got a thumbnail.
- Writes go through the existing `POST /api/thumbnails`, which re-checks ownership, caps size and verifies magic bytes. `canUpdatePreview` governs what is *offered*, never what is permitted.

## Database migrations

`lib/db/migrations/` + `meta/_journal.json`, applied by the neon-http migrator (`npm run db:migrate`, which `npm run build` runs first).

**Migrations are hand-written and idempotent** — the 0039+ convention. Each statement must be safe to re-apply (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`), because the neon-http migrator runs them over HTTP with **no wrapping transaction**: a file that fails halfway leaves the earlier statements applied. Write the `.sql`, then append an entry to `meta/_journal.json` (`idx`, `tag`, and a `when` past the previous one).

`npm run db:generate` (`drizzle-kit generate`) is only a **scaffold**: read its output, don't ship it unread. The generated SQL is not idempotent, and it silently omits data backfills. It also can't run against a DB, so it never sees what's actually applied — it diffs your schema against `meta/<last>_snapshot.json` alone. If that snapshot drifts from reality, the diff is nonsense: in Aug 2026 the snapshots had stopped at 0038 while the journal was at 0057, and `generate` emitted ~20 migrations of already-applied DDL, including `CREATE TABLE` for existing tables. Repaired by keeping the snapshot generate produces and discarding its SQL. **If you add a migration by hand, refresh the snapshot too** or the drift returns:

```
npx drizzle-kit generate --name snapshot_refresh   # writes bogus SQL + a CORRECT snapshot
rm lib/db/migrations/<n>_snapshot_refresh.sql      # discard the SQL
git checkout lib/db/migrations/meta/_journal.json  # discard its journal entry
mv lib/db/migrations/meta/<n>_snapshot.json \
   lib/db/migrations/meta/<your-migration-idx>_snapshot.json
```

Verify with a second `npx drizzle-kit generate` — a healthy tree reports "No schema changes, nothing to migrate".

## Testing

- `vitest` with the setup at `vitest.setup.ts` that pre-mocks `@clerk/nextjs/server`, `next/cache`, `next/navigation`, and `server-only`. New tests don't need to re-mock these.
- Tests co-located under `__tests__` siblings to the code they cover.
- Server actions are tested by mocking `@/lib/db`, `@/lib/storage`, and `@/lib/logger` — see `app/actions/__tests__/files.test.ts` for the pattern.
- Before adding a runtime assertion or refactor, check whether the existing test suite already covers the contract. Run `npx vitest run` before committing.
- **Pre-commit gate is `npm run build`, not filtered `tsc`**. `tsconfig.json` includes `**/*.ts` (scripts/, tests, everything), and Next's build pass is the only place the full program is type-checked for real. Never gate commits on `tsc --noEmit | grep <file>` — grep-filtered output hides errors in files you didn't touch this turn, and Vercel is then the first unfiltered pass. Seen once: `scripts/seed-resume-test.ts` shipped with a bad `users` column reference because the grep filter hid it from the local sanity check.
- `npm run typecheck` (`tsc --noEmit`) is a fast, DB-free full-program type check — the same check CI runs as its own step. `npm run build` still requires `DATABASE_URL` (it runs `db:migrate` first), so `npm run typecheck` is the check to reach for locally when you don't have DB credentials handy.

## Common pitfalls

- **Clerk session cookie lag**: a server action called immediately after `await setActive()` may still see `userId: null`. When chaining, prefer the OTP-in-form pattern in `ShippingAddressForm` which stashes the payload and lets the Clerk client finish before the parent runs the server actions.
- **iOS keyboard push**: the home bottom bar uses the VisualViewport API to reposition above the keyboard; `app/layout.tsx` exports `viewport.interactiveWidget = "overlays-content"`. Don't regress this.
