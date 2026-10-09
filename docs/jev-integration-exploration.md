# Jev Integration Exploration

**Status:** Initial exploration  
**Date:** September 2026

## What is Jev?

Jev is a "System One Model" from TypeSafe AI — a purpose-built decision engine (not an LLM) that excels at fast, structured classification and routing:

- **Single parallel pass** for all decision outputs (70–500ms vs LLM latency of 3–329s)
- **~200x faster, 400x cheaper** than frontier LLMs for structured tasks
- **Requires typed schemas** — predefined answer formats, not free-form generation
- Cannot write or reason; only classify/route with confidence scores

---

## Integration Opportunities

### 1. **File Classification at Upload** ⭐ HIGH PRIORITY

**Current state:** Files are uploaded with an optional creator-chosen category slug. Categories are editorial (21 curated slugs) — creators pick manually via a Select.

**Jev fit:** Auto-classify uploaded 3D models into `CATEGORIES` based on:
- Model geometry (dimensions, volume, complexity)
- Filename/title similarity to keywords
- Topology hints (open/closed mesh, support structure indicators)

**Implementation:**
- At upload time (before R2 storage), extract geometry metadata + filename
- Call Jev with schema: `{ input: { geometry, filename }, output: { category: CATEGORY_IDS } }`
- Store `category` on the `files` row + confidence score
- UX: pre-fill the category picker with confidence (user can override)

**Value:**
- Faster uploads (no manual picking required for browse sorting)
- Better search/browse (auto-tagged files match more queries)
- Consistent taxonomy (Jev learns from the curated set, no free-form category creep)

**Related code:**
- `lib/categories/index.ts` — category catalog
- `app/actions/files.ts` — file creation endpoint
- `lib/geometry-checks.ts` — available geometry properties

---

### 2. **Print Order Vendor Routing** ⭐ MEDIUM PRIORITY

**Current state:** Quote polling (`components/print/poll-quotes.ts`) hits all vendors for a material + geometry combo. User then picks from all quotes (sorted by price). CraftCloud does all the real validation.

**Jev fit:** Pre-filter vendors before polling, or rank quotes after polling:
- Route based on model properties (size, complexity, material suitability)
- Estimate printability (will it need support? wall thickness warnings?)
- Rank vendor responses by fit (speed + cost + confidence)

**Implementation option A (early routing):**
```
Jev schema: {
  input: { material_config_id, model_geometry, model_volume },
  output: {
    recommended_vendors: string[],
    printability_score: 0..1,
    warnings: string[]  // "needs support", "wall thickness low", etc.
  }
}
```
- Before `createCart()`, call Jev to narrow the vendor pool
- Only poll the subset → faster quote time, simpler UI

**Implementation option B (post-polling ranking):**
- After quotes arrive, re-score with Jev considering vendor response time + price + fit
- Reorder the material picker's default selection

**Value:**
- Faster quote times (fewer vendors to poll if we route early)
- Better recommendations (UX pre-filters impossible combos)
- Confidence-based filtering (Jev's score gates risky combos)

**Related code:**
- `components/print/poll-quotes.ts` — polling loop (terminates when stable)
- `components/print/quote-configurator.tsx` — order creation
- `lib/craftcloud/catalog.ts` — vendor + material metadata

---

### 3. **File Printability Scoring** ⭐ MEDIUM PRIORITY

**Current state:** `lib/geometry-checks.ts` runs soft hints (non-blocking warnings). This is one-shot heuristic rules, no learning.

**Jev fit:** Replace with learned model:
- Ingest geometry data + successful historical prints of similar models
- Return: `{ printable: bool, confidence: 0..1, reason: string }`
- Surface as a badge on browse cards, file detail page

**Implementation:**
- Jev schema: `{ input: { geometry, material_config }, output: { printable: bool, confidence: 0..1 } }`
- Call on file detail load (cached on `files.printability_confidence`)
- Badge: ✓ Printable (98%) vs ⚠ Risky (60%) vs ✗ Not recommended (22%)

**Value:**
- Data-driven filtering (browse/search can gate risky files)
- Less manual moderation (surface high-risk files for review, not auto-block)

**Related code:**
- `lib/geometry-checks.ts` — current heuristic rules
- `app/(app)/files/[slug]/page.tsx` — file detail (where badge renders)

---

### 4. **CAD Studio Optimization Routing** ⭐ LOW PRIORITY (if CAD studio exists)

**Current state:** Text-to-CAD studio exists but unclear what optimizations are offered.

**Jev fit:** Route uploaded CAD models to optimization suggestions:
- Detect thin walls → suggest support structure library
- Detect hanging geometry → auto-orient recommendations
- Detect material incompatibility → suggest material swap

**Implementation:**
- Jev schema: `{ input: { cad_features, model_type }, output: { optimization_class: OPTIMIZATION_TYPES } }`
- Emit structured recommendations instead of free-text LLM output

**Value:**
- Fast, structured feedback (no LLM latency for routine suggestions)
- Confidence-gated (low confidence → route to human review)

**Related code:**
- `app/(app)/prometheus` or similar (if Text-to-CAD studio path exists)

---

## Non-Opportunities

- **Binary hashing / file deduplication** — Jev doesn't do cryptography or binary processing
- **3D mesh normalization / bounds calculation** — Jev is a decision engine, not a geometry processor (use Sharp, Drizzle, or specialized mesh libraries)
- **Thumbnail generation** — Not Jev's domain (canvas encode, WebP transcode stay with Sharp)

---

## Implementation Roadmap

### Phase 1: File Classification (Foundation)
1. Design Jev input schema for file classification
2. Integrate at upload time (`app/actions/files.ts`)
3. Test with sample models (auto-classify vs manual override)
4. Add confidence score to UI (picker pre-fill)

### Phase 2: Vendor Routing (Print Pipeline)
1. Integrate Jev call before quote polling
2. Measure: quote time reduction, user satisfaction (did pre-filter help?)
3. A/B test: all vendors vs Jev-filtered subset

### Phase 3: Printability Scoring (Browse/Search)
1. Retrain Jev model on historical print success data
2. Backfill existing files
3. Add badge to browse cards, file detail

### Phase 4: CAD Studio (if applicable)
1. Define optimization classes
2. Route models post-processing

---

## Technical Checklist

- [ ] Jev API key + endpoint (TypeSafe provider / docs)
- [ ] Rate limits, pricing, SLA review
- [ ] Error handling (Jev down, timeout, confidence too low)
- [ ] Caching strategy (geometry classification stable per file → cache on `files` row)
- [ ] Telemetry (track Jev call latency, confidence distribution, user overrides)
- [ ] Fallback paths (no Jev → graceful degrade to manual category picker)
- [ ] DB schema updates (new columns: `files.category_confidence`, `printOrders.jev_recommended_vendors`, etc.)

---

## Questions for Stakeholder

1. Priority ranking — which opportunity delivers most user value first?
2. CAD studio — is there an active Text-to-CAD feature this should integrate with?
3. Data access — do we have historical print success data to train printability scoring?
4. Cost tolerance — Jev is cheap (~$0.0004/decision), but what's the call volume estimate?
