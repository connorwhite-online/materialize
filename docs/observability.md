# Observability — Sentry wiring

We use [Sentry](https://sentry.io) for production error monitoring. The SDK is
wired but inert until the env vars below are set; a fresh checkout builds and
runs without touching Sentry.

## Why this exists

Two reasons, in order of importance:

1. **Production bugs are invisible without it.** Vercel's built-in logs are
   per-deploy and don't aggregate across instances; an exception in a server
   action shows up as one line in one log stream and disappears. Sentry
   surfaces every uncaught throw as a structured event with stack + breadcrumbs
   + request context.

2. **It's the input to the self-healing loop.** The autonomous fixer workflow
   (see `docs/agent-fixer.md`, TBD) is triggered by Sentry webhook on new
   issues. Without structured events with stable signatures, the loop has
   nothing to react to.

## What's instrumented

- `instrumentation.ts` initializes Sentry on the server runtime and forwards
  request errors via `Sentry.captureRequestError`.
- `instrumentation-client.ts` initializes Sentry in the browser and wires
  router-transition tracing.
- `sentry.server.config.ts` / `sentry.edge.config.ts` hold runtime-specific
  config (sample rates, ignored noise, PII scrubbing).
- `lib/logger.ts` — every existing `logError(context, error)` call site fans
  out to `Sentry.captureException` automatically. No need to sprinkle
  `captureException` calls throughout the codebase; tagging the context string
  preserves the per-call-site signature.
- `lib/observability/scrub-pii.ts` — `beforeSend` hook redacts emails, phone
  numbers, auth headers, and Clerk session cookies before events leave the
  process. Clerk userIds are kept (they're opaque and useful for reproducing).

## Required env vars

Add these to `.env.local` (dev) and to Vercel project env (preview + prod):

| Var | Where to get it | When it's used |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry project settings → Client Keys | Runtime — every event |
| `SENTRY_AUTH_TOKEN` | Sentry user settings → Auth Tokens (scopes: `project:releases`, `org:read`) | Build — source-map upload |
| `SENTRY_ORG` | Your Sentry org slug | Build — source-map upload |
| `SENTRY_PROJECT` | The project slug | Build — source-map upload |
| `SENTRY_TEST_SECRET` | Anything random | Dev only — gates `/api/internal/sentry-test` |

The `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` triple is only used
by `withSentryConfig` to upload source maps at build time. Without them, builds
still succeed but production stacks render against the minified JS.

## Smoke-test the wiring

1. Set the env vars above in `.env.local`.
2. `npm run dev`.
3. From another terminal:

   ```bash
   curl -H "x-sentry-test-secret: $SENTRY_TEST_SECRET" \
     http://localhost:3000/api/internal/sentry-test
   ```

4. Within ~30s, a new event titled "Sentry wiring smoke test fired at …"
   appears in the Sentry dashboard, tagged `context=sentry-test`.

If it doesn't appear, check:

- The dev server console — `[sentry-test]` line should be present (logger
  fired) but the Sentry SDK might be initializing without a DSN.
- `NEXT_PUBLIC_SENTRY_DSN` is exposed to the runtime (the `NEXT_PUBLIC_`
  prefix matters).
- The Sentry project's data-residency region matches what your DSN points at.

The route is disabled in production (`NODE_ENV === "production"` short-
circuits before the secret check).

## What's *not* yet wired

- Sentry Session Replay — extra paid SKU, would add ~30 KB to every page.
  Defer until breadcrumbs alone become insufficient for reproducing client
  bugs.
- `Sentry.setUser({ id })` is not automatically attached per request. There's
  a helper at `lib/observability/set-sentry-user.ts` that callers can invoke
  at the top of an authed server action; a follow-up will hook it into a
  shared middleware-style helper so every authed code path is tagged
  automatically.
- Performance traces (`tracesSampleRate`) are at 10% in prod, 100% in dev. If
  free-tier event volume becomes a constraint, tune the prod rate down.

## Sentry-fixer agent loop (Phase 3)

Once Sentry is wired, the self-healing pipeline activates:

```
Sentry alert fires
  → POST /api/internal/sentry-trigger (HMAC or shared-secret + freshness)
  → dispatches the `sentry-fixer` GitHub Action with the event JSON
  → fresh CI runner installs deps + Playwright, then runs
    scripts/sentry-fixer.ts which spawns a Claude Agent SDK session
  → session reproduces the bug, writes a regression test, fixes
    the root cause, runs full gates (tsc + vitest + playwright),
    pushes the branch fix/sentry-<event_id>
  → human reviews the PR and merges
```

### Sentry side (one-time)

Sentry's modern Internal Integrations don't let you add custom headers to
outbound webhooks — they sign them with HMAC-SHA-256 against the integration's
**Client Secret** instead. Our trigger route accepts both auth modes:

- **HMAC mode** (Sentry-native): `Sentry-Hook-Signature` verified against
  `SENTRY_INTEGRATION_CLIENT_SECRET`. This is what Sentry's UI gives you.
  Dispatch still requires `environment=production` (or whatever
  `SENTRY_TRIGGER_ENVIRONMENT` lists). Official `issue.created` payloads
  omit that field, so they are skipped on purpose — otherwise a preview
  or local first-seen issue would start a fixer run. Prefer an Alert
  Rule or the `error` webhook (both carry `event.environment`).
  Non-`created` issue actions (`resolved`, `assigned`, …) are skipped.
- **Shared-header mode**: `X-Sentry-Trigger-Secret` matched against
  `SENTRY_TRIGGER_SECRET`, plus a freshness signal so a captured request
  cannot be replayed. Sentry-native freshness is always accepted:
  `Sentry-Hook-Timestamp` (Internal Integration) or the event's
  `timestamp`/`datetime` (Alert Rules). The manual curl header
  `X-Sentry-Trigger-Timestamp` is only honored when
  `SENTRY_TRIGGER_ALLOW_SHARED_SECRET` is explicitly enabled (or HMAC
  is not configured). Header window defaults to 300s; payload timestamps
  use 7200s because an alert can fire on a burst whose first event is
  minutes old.

At least one auth mode must be configured. HMAC works on its own. Alert
Rule webhooks that send the shared secret do **not** need the curl flag —
that flag is only the hand-run path.

**For Sentry's Internal Integration:**

1. In Sentry: **Settings → Custom Integrations → Create New Integration →
   Internal**.
2. Set the **Webhook URL** to `https://www.materialize.cc/api/internal/sentry-trigger`.
3. Under **Webhooks**, check `Errors` (the event payload includes
   `environment`, which is what the production-only gate reads).
   `Issues` alone is not enough — `issue.created` has no environment
   field and is skipped so preview / local testing cannot start a run.
4. Permissions: `Issue & Event → Read` is sufficient.
5. Save. Sentry shows you a **Client Secret** — copy it.
6. Add it to Vercel env (Production + Preview):
   ```
   SENTRY_INTEGRATION_CLIENT_SECRET=<client secret from Sentry>
   ```

**Optionally also set the shared secret for manual triggers:**

```bash
echo 'SENTRY_TRIGGER_SECRET="'"$(openssl rand -hex 32)"'"' >> .env.local
echo 'SENTRY_TRIGGER_ALLOW_SHARED_SECRET=1' >> .env.local
```

The flag is only required for the hand-run `X-Sentry-Trigger-Timestamp`
path. Alert Rule deliveries authenticate via the event timestamp even
when the flag is unset. Mirror the flag to Vercel only where you actually
want manual triggers. Then you can `curl` the trigger route with the secret and
a fresh timestamp:

```bash
curl -X POST https://www.materialize.cc/api/internal/sentry-trigger \
  -H "X-Sentry-Trigger-Secret: <value>" \
  -H "X-Sentry-Trigger-Timestamp: $(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production", ...}'
```

The timestamp must be within `SENTRY_TRIGGER_TIMESTAMP_WINDOW_SECONDS` (default
300) of the server clock, so a captured request can't be replayed later.

### GitHub side (one-time)

3. Generate a fine-grained PAT with `actions:write` scope on the materialize
   repo. Vercel env:
   ```
   GITHUB_DISPATCH_TOKEN=<the PAT>
   GITHUB_REPO=<owner>/materialize
   ```
4. In the materialize repo's settings → Secrets and variables → Actions, add
   ONE of these two auth options (or both — the workflow prefers OAuth):

   **Option A (recommended): subscription-backed OAuth token.**
   Bills against your Claude Pro/Max plan's included usage rather than
   metered API tokens. Run `claude setup-token` on your laptop, copy the
   output, and add as `CLAUDE_CODE_OAUTH_TOKEN`. Subject to the
   subscription's rate limits — burst-heavy runs (10+ in a 5-hour window)
   may hit 429s.

   **Option B: metered API key.**
   Pay-per-token, no rate limits beyond billing. Generate at
   console.anthropic.com → Settings → API Keys, add as `ANTHROPIC_API_KEY`.
   Typical run costs $0.20–$5 depending on session length.

   Also add the application secrets the agent's e2e tests need:
   `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `STRIPE_SECRET_KEY`.

### Costs + caveats

- Every fixer run bills Claude tokens. A typical session uses ~$0.50–$5
  depending on how many turns it takes to reproduce + fix. Hard timeout at
  30 minutes inside `scripts/sentry-fixer.ts`.
- The agent opens a PR via `gh pr create` after pushing the branch; it
  NEVER merges. A human reviews and merges. Forbidden paths (schema,
  payouts, webhook handlers, proxy) are enforced in the prompt — the agent
  must escalate (write a summary, stop) rather than touch those files.
- The agent's `cwd` is the CI runner's checkout — not a worktree on the prod
  DB. Tests run against `DATABASE_URL` from the secrets store; that's
  whatever Neon branch you wire up. v1 reuses the dev branch for simplicity;
  spinning a per-event Neon branch is a future upgrade.
- Manual replay: any Sentry event JSON can be pasted into the workflow's
  `sentry_event` input from the Actions tab. Useful for retrying or for
  testing the loop on synthetic events.
