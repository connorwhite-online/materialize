# Deferred — Spike: missing US vendors + cheapest-quote styling

Two related items, queued behind the active UI pass.

## 1. Spike: why are US vendors missing from our quote results?

### Symptom

Uploading the same model (the carabiner test file) directly to
craftcloud3d.com shows US-based manufacturers with **higher production
cost but much lower shipping** — net total cheaper than what
Materialize surfaces. On Materialize, only high-shipping options
(non-US vendors shipping into the US) appear, suggesting US vendor
quotes aren't reaching the configurator.

### What we've ruled out

- `countryCode` default is `"US"` in both
  [lib/validations/print.ts:9](lib/validations/print.ts#L9) and
  [components/print/shipping-address-form.tsx:107](components/print/shipping-address-form.tsx#L107).
  We are sending US as the destination, so it's not a wrong-country
  bug at the request layer.

### Plausible root causes (start here)

1. **Polling termination exits early.** Our snapshot polling loop
   stops when CraftCloud reports `allComplete: true` AND the quote
   count has been stable for 4 polls
   ([components/print/quote-configurator.tsx](components/print/quote-configurator.tsx)
   `fetchQuotes`). US vendors may be slower than the 4-poll window in
   some material categories — quotes arrive AFTER we've stopped
   polling and snapshot is final. Worth instrumenting per-poll vendor
   counts to confirm.
2. **`materialConfigIds` scoping excludes US-only configs.** When the
   user comes from `/materials/[slug]` we narrow the request to the
   material's full config set
   ([app/api/craftcloud/quotes/route.ts:79-92](app/api/craftcloud/quotes/route.ts#L79)).
   If a US vendor offers a config that CraftCloud's catalog API
   returns under a different id than what's in the cached catalog, we'd
   silently filter them out. Compare our `materialConfigIds` against
   what direct-on-craftcloud actually requests for the same selection.
3. **Snapshot dedupe on `configId+vendorId` drops late arrivals.**
   Check the poll route's merge logic
   ([app/api/craftcloud/quotes/poll/route.ts](app/api/craftcloud/quotes/poll/route.ts))
   — if a duplicate-key check evicts a late US vendor's quote, that
   would explain selective absence.
4. **Sort/render-side filter.** UI may be ordering by production cost
   only and pushing high-production US options below the visible
   threshold. Audit `MaterialPicker` / `PriceDisplay` for any sort or
   filter that doesn't use total (production + shipping).

### Suggested spike path

- Add per-poll logging of `{vendor, country, productionCost,
  shippingCost, total}` for one printable test geometry, with US
  destination + a common material like "PLA Black".
- Run the same selection on craftcloud3d.com directly, capture the
  network response, diff vendor lists.
- Pick the missing US vendor with the largest delta, trace where it
  drops out: pre-request filter, polling termination, snapshot merge,
  or render sort.

Half-day spike before any fix work; the fix scope depends on which
of (1-4) it turns out to be.

## 2. Cheapest-quote styling on the vendor selection page

Once total-price ordering is correct (or as a standalone polish item
if the spike confirms vendors are right but ranking is muddled),
distinguish the lowest-total-price quote in the
[MaterialPicker](components/print/material-picker/) vendor list with
a "Best price" pill or accent border. Today every vendor row is
visually equal, so the user has to compare numbers manually.

Decision still open: best by **total** (production + shipping +
service fee, in viewer's currency), best by **production cost**, or
best by **production-time × cost** if we want to weight fast-and-
cheap together. Default to **total** — that's the number the buyer
actually pays.

## Why we paused

Active UI pass on file/project detail and notifications surface is
in flight; better to land that, then come back to the print pipeline
with a clean head.
