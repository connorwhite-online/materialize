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

**Polling invariant** — `/api/craftcloud/quotes/poll` is polled by the client until CraftCloud reports `allComplete: true` AND the quote count has been stable for 4 consecutive polls. We do NOT break on the first `allComplete: true` alone — CraftCloud will occasionally flip it true with an empty array on cached library modelIds, or while late vendors are still responding. See `quote-configurator.tsx` → `fetchQuotes`.

**Idempotency** — the anon checkout chain (R2 → draft → order → Stripe) uses a `checkoutInFlightRef` to prevent double-fire. The Stripe webhook checks `order.craftCloudOrderId` in addition to `order.status` so a retry after a partial commit doesn't re-place the CraftCloud order.

### Anon OTP sign-up at checkout

The revenue shortcut. Anon users walk the full quote flow, then enter email on the shipping form. Inside `ShippingAddressForm`, we run `signUp.create({ emailAddress })` + `prepareEmailAddressVerification` inline, show the OTP step, `attemptEmailAddressVerification` + `setActive`, then `setUsernameFromEmail` (best-effort), then call the parent's `onSubmit` with the stashed address payload. If the email already exists we pivot to `signIn` email-code instead. All in one form, no modal.

## Server action vs API route

- **Server actions** (`app/actions/*`) for anything that mutates the DB and is called from a client component with `useTransition` or a form submit. Easier to revalidate paths / tags.
- **API routes** (`app/api/**/route.ts`) for cross-origin webhooks (Stripe), signed-URL flows, anything the client needs to `fetch()` directly, and anything called by external services.
- CraftCloud quote start + poll is split into two routes (`app/api/craftcloud/quotes/route.ts` + `app/api/craftcloud/quotes/poll/route.ts`) because the polling loop lives on the client — keep it that way, do not hide a long-lived polling loop behind a server action.

## Material catalog gotcha

There are **two** material sources and they do NOT share ids:

- `lib/materials/` — our curated display catalog (PLA White, PLA Black, Titanium Grade 5, …) used for filter chips, material landing pages, listing recommendations, and the home hero carousel (`HERO_MATERIALS`).
- `lib/craftcloud/catalog.ts` — CraftCloud's upstream catalog (materials, finish groups, configs, vendors, providers). 24h-cached. Every id here is a CraftCloud UUID.

`MaterialPicker.preselectMaterialId` expects a **CraftCloud** id. `/materials/[slug]` pulls from the CraftCloud catalog (not lib/materials), so the "Print with X" link passes the right kind of id already. Any new consumer of `preselectMaterialId` must do the same — local lib/materials ids will silently no-op.

## Fonts

- **Body** — system font stack (`-apple-system, SF Pro, …`), set in `app/globals.css` via `--font-sans`. No webfont download.
- **Hero display** — local OTFs in `public/`: `PPFuji-Bold.otf` as `--font-display` and `PPPlayground-Light.otf` as `--font-script`. Loaded via `next/font/local` in `app/layout.tsx`. Used in `HeroWordmark` and the nav brand link.

## Testing

- `vitest` with the setup at `vitest.setup.ts` that pre-mocks `@clerk/nextjs/server`, `next/cache`, `next/navigation`, and `server-only`. New tests don't need to re-mock these.
- Tests co-located under `__tests__` siblings to the code they cover.
- Server actions are tested by mocking `@/lib/db`, `@/lib/storage`, and `@/lib/logger` — see `app/actions/__tests__/files.test.ts` for the pattern.
- Before adding a runtime assertion or refactor, check whether the existing test suite already covers the contract. Run `npx vitest run` before committing.
- **Pre-commit gate is `npm run build`, not filtered `tsc`**. `tsconfig.json` includes `**/*.ts` (scripts/, tests, everything), and Next's build pass is the only place the full program is type-checked for real. Never gate commits on `tsc --noEmit | grep <file>` — grep-filtered output hides errors in files you didn't touch this turn, and Vercel is then the first unfiltered pass. Seen once: `scripts/seed-resume-test.ts` shipped with a bad `users` column reference because the grep filter hid it from the local sanity check.

## Common pitfalls

- **Clerk session cookie lag**: a server action called immediately after `await setActive()` may still see `userId: null`. When chaining, prefer the OTP-in-form pattern in `ShippingAddressForm` which stashes the payload and lets the Clerk client finish before the parent runs the server actions.
- **iOS keyboard push**: the home bottom bar uses the VisualViewport API to reposition above the keyboard; `app/layout.tsx` exports `viewport.interactiveWidget = "overlays-content"`. Don't regress this.
- **Flex-shrink on SVG wordmarks**: `HeroWordmark` SVGs need `shrink-0`, otherwise flex compresses the width against the `max-w-5xl` parent and the text becomes tiny at high heights. Learned twice.
