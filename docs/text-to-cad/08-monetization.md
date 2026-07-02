# 08 — Funding the studio: credits-in-subscription + BYOK

Status: **decision doc** (Needs Decision). No implementation until the owner picks the
defaults below. Release is far out; the near-term value is (a) architectural seams that
keep both paths cheap later, and (b) BYOK as a pre-release mechanism so allowlisted
testers self-fund model usage.

## Cost structure (why metered, not flat)

Every generation has real marginal cost:

- Model tokens: plan/brief + generate + ≤3 repairs + judge (per-role models via
  `CAD_MODEL_*`, `lib/cad/models.ts`). Agentic sessions (doc 03) raise the ceiling.
- Sidecar compute: 60s CPU cap today; FEA probes and topopt jobs later (minutes-scale).
- fal.ai: concept image ~$0.003/gen; generative path ~$0.16 (Hunyuan3D) to ~$0.40–2
  (Rodin) (`lib/cad/generative.ts:23-31`).

Flat "unlimited" tiers invite the wrong tail. **Credits inside a subscription** fit:
plans include monthly credits; heavier machinery costs more credits (which maps exactly
onto doc 03's complexity tiers and the doc 02 job model — a job is the natural metering
unit and its `cadJobs` row the natural ledger anchor).

## Strategic alignment (the one non-obvious call)

Revenue is the 3% print fee — the studio is ultimately a funnel into print orders.
**Refund or discount generation credits when a design is printed.** The join already
exists (generation → `printOrders` via `fileAssetId`, used by the eval scorecard's
print-through metric). This prices the studio as a loss-leader for exactly the users the
marketplace wants, and makes "generate here → print here" the economically rational path.

## BYOK (bring your own key)

Architecturally cheap because the seams exist: `lib/cad/model-client.ts` resolves
credentials from env at module scope; `modelForRole` routes per role.

Changes:

- **Credential resolution layer**: `resolveModelCredentials(userId) → user key | platform
  key`. Per-request client instantiation (kill the module-level `_client` singleton).
- **Key storage**: new `userModelKeys` table — provider, encrypted key (KMS/AES-GCM with
  a key-encryption-key in env, never plaintext at rest), createdAt, lastUsedAt, a
  key-check status. Never log keys; redact in Sentry.
- **Scope**: BYOK covers **model tokens only**. Sidecar compute, fal calls, and storage
  are still ours → BYOK users still consume (fewer) credits. This keeps agentic/topopt
  metering coherent.
- **Abuse**: strict per-user rate caps on `/api/cad/generate` regardless of key origin
  (MTR-169 is the open issue for the cap; land it before BYOK), and use the user's key
  *only* for that user's generations.
- **Disclosure**: our system prompts/exemplars travel under the user's key and are
  visible in their provider logs. Accepted (it's taste, not secrets) — but state it in
  the BYOK settings copy.
- **Compat note**: `CLAUDE_CODE_OAUTH_TOKEN`-style subscription auth is env-fallback
  today (`model-client.ts`); BYOK should accept API keys only — per-user OAuth delegation
  is a ToS/product question we don't need to answer now.

## Hard gate (before ANY multi-user or BYOK exposure)

The sidecar executes arbitrary model-generated Python with the container as the only
boundary (`cad-runner/app.py` header: "adequate for the owner-only v0"). Multi-user =
hostile-prompt users sharing that boundary. gVisor/Firecracker/per-run microVM isolation
is a **blocking prerequisite**, tracked as its own issue when the time comes. BYOK also
raises the stakes of SSRF/exfil from inside generated code (someone else's key material
must never be reachable from the exec namespace — it isn't today, keys stay in the
Next.js layer; keep it that way).

## Decisions needed from the owner (🔵)

1. **Credit refund-on-print**: full refund, partial (e.g. 50%), or discount-only?
   (Recommendation: full refund capped at N credits/order — cleanest story.)
2. **BYOK pre-release**: enable for allowlisted testers as the *first* monetization-ish
   step? (Recommendation: yes — zero pricing decisions required, real economics data,
   testers self-fund.)
3. **Credit unit**: abstract "credits" vs transparent per-generation pricing?
   (Recommendation: credits; the cost mix — tokens + CPU + fal — is too heterogeneous to
   expose honestly per-unit.)
4. **Anonymous/free taste**: any free generations for logged-in users pre-subscription?
   (Recommendation: small monthly grant — the funnel argument again; revisit at release.)

## Sequencing

Nothing here blocks docs 01–07. When picked up: MTR-169 (rate caps) → credential
resolution layer + key storage (BYOK for testers) → credit ledger riding `cadJobs`
(doc 02) → plans/pricing (release-time).
