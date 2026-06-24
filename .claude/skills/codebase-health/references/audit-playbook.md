# Audit Playbook

What to look for, per category. Each subagent (or direct pass) gets the relevant section plus the **Finding format** at the bottom. Adapt depth to repo size.

A finding is only a finding **with evidence**. "Probably has N+1 queries somewhere" is not a finding; `orders/api.ts:142 issues one query per order item inside a loop` is.

> Adapted from shadcn/improve (MIT). Categories extended with **Observability** and a Linear label map for this workspace.

---

## 1. Correctness / Bugs — label `Bug`

The highest-trust category — real bugs found by reading, not speculation.

- Error handling: swallowed exceptions, empty catch blocks, `catch (e) { console.log(e) }` on critical paths, missing error states in UI code.
- Async hazards: unawaited promises, race conditions on shared state, missing cancellation/cleanup (stale closures in React effects, listeners never removed).
- Null/undefined flows: non-null assertions (`!`) on nullable values, optional chaining hiding a value that must exist, unchecked array indexing.
- Boundary conditions: off-by-one, empty-collection handling, timezone/locale assumptions, integer overflow in counters/IDs.
- State machines: impossible-state combinations representable in types, status enums with unhandled branches (`default:` that silently no-ops). **For Materialize, the 12-state `printOrderStatusEnum` (CON-153) is the canonical example — unhandled branches here are high-impact.**
- Concurrency & idempotency: check-then-act on shared resources, missing transactions around multi-write ops, non-idempotent retried operations (webhooks, queues, the Stripe webhook / anon checkout chain).
- Type escape hatches: `any` / `as` casts / `@ts-ignore` clusters — each is a place the compiler was overruled.
- Resource leaks: unclosed handles, connections, subscriptions; missing `finally`.

## 2. Security — label `Bug` (priority Urgent/High)

Review only what code evidence supports. Frame findings as defensive maintenance: identify the pattern, explain production impact, describe remediation at the level of code/config/test changes. **No runnable exploit strings or step-by-step misuse details.**

**Handling rule:** never copy a secret value into an issue (issues are shared and indexed). Reference `file:line` and credential type only ("Stripe live key at `config.ts:12`"); the fix always includes **rotation**, not just removal (a committed secret is burned).

**By-design is not a finding:** standard platform conventions (honoring `https_proxy`/`NO_PROXY`, reading `~/.netrc`) are intentional. A tradeoff recorded in an ADR / the Linear project description is settled. Flag only when the *implementation* adds risk beyond the convention. A **stale ADR is itself a finding** — if code drifted from the decision doc, report the drift.

- Credential hygiene: hardcoded keys/tokens, credentials in committed `.env`, credentials logged or persisted. Name only type + location; recommend removal, rotation, safer config path.
- Data crossing into interpreters/privileged APIs: SQL/shell from request data (injection), HTML sinks fed user content (XSS), dynamic execution with runtime input, filesystem paths from request data (traversal). Describe the safer API/boundary; no runnable examples.
- Access control: routes/server actions lacking server-side identity checks, authz enforced only client-side, object access by ID without ownership/tenant checks (IDOR), missing CSRF on state-changing routes. **Materialize: server actions that mutate must verify Clerk identity; agent-billing paths gate on the kill switch.**
- Input contracts: API boundaries trusting request bodies without schema validation, uploads without type/size/storage constraints, mass assignment into persistence models.
- Dependency posture: run the ecosystem audit (`npm audit`) read-only. Report only critical/high advisories reachable in runtime or build/distribution paths; avoid low-signal noise.
- Production config: overly broad CORS with credentials, missing hardening headers (CSP) on sensitive surfaces, cookies missing `HttpOnly`/`Secure`/`SameSite`, debug/verbose behavior in prod.
- Data minimization: PII / sensitive operational data in logs, stack traces returned to clients, internal error detail in API responses.

## 3. Performance — label `Improvement`

Algorithmic and architectural wins, not micro-optimizations.

- N+1 patterns: query/fetch per item inside loops or per list-row render; missing batching/dataloader.
- Wrong complexity: nested scans over the same collection, repeated `find`/`filter` in hot loops where a keyed Map belongs.
- Caching gaps: identical expensive computations/fetches repeated per request/render; missing memoization at clear boundaries; no data-layer caching on stable data (e.g. the 24h-cached CraftCloud catalog pattern).
- Payload size: over-fetching (`select *`, full objects where IDs suffice), missing pagination on unbounded lists, large JSON shipped to clients.
- Frontend: bundle composition (heavy deps for trivial use), missing code-splitting on rare routes, unoptimized images/fonts, client-side fetching for render-time data, render waterfalls. For Next.js, defer to the repo's framework conventions.
- Backend: synchronous work that belongs in a queue/cron, missing indexes implied by query patterns (flag for verification — don't claim without schema evidence), connection-per-request where pooling exists.
- Build/CI: slow CI from missing caching, redundant steps, test suites that could parallelize.

## 4. Test Coverage — label `Improvement`

The goal is not a percentage — it's *which untested code is dangerous*.

- Map the critical paths (money, auth, data mutation, the feature the repo exists for — for Materialize: the print-quote pipeline, checkout chains, Stripe webhook) and check which have zero/trivial coverage.
- High-churn (git log) + no tests = top refactor risk; flag as "characterization tests first."
- Existing test quality: assertions that assert nothing, heavy mocking that tests the mocks, snapshot tests nobody reads, flaky patterns (real timers/network, order dependence).
- Missing layers: unit-only with no integration coverage on API boundaries, or slow E2E for what a unit test would catch.
- Verification infra: is there a one-command "does it work" (`npm run build`, `npx vitest run`)? If not, that's finding #1 and a prerequisite for any risky change.

## 5. Tech Debt & Architecture — label `Improvement` (or `DX` for naming/contracts/dead-code)

- Duplication: the same logic in 3+ places; divergent copies that drifted.
- Layering violations: UI importing data-layer internals, circular deps, "utils" junk drawers with high fan-in.
- Dead code: unexported-and-unused modules, fully-rolled-out flags still branching, commented-out blocks, manifest deps no longer imported. **Materialize note: `quoting` status is dead (default only, no reader) — known, not a finding.**
- God objects/modules: files an order of magnitude larger than the median that everything touches; functions with double-digit params or deep nesting.
- Inconsistent patterns: three ways to fetch / handle errors / style in one repo — pick the winner (most recently converged) and plan consolidation.
- Abstraction mismatches: premature abstraction with one implementation, or a missing one where the same change always touches N files in lockstep (the CON-153 "consumer checklist" is a live example).

## 6. Dependencies & Migrations — label `Improvement`

- Major-version lag on core framework/runtime with real cost (EOL, security-fix cutoffs, ecosystem incompat) — not every minor bump. **Note: this repo runs a modified Next.js; check `node_modules/next/dist/docs/` per AGENTS.md before flagging Next API usage.**
- Deprecated APIs with announced removal timelines.
- Abandoned deps (no release in years, archived) on critical paths.
- Duplicate deps solving the same problem (two date libs, two HTTP clients).
- Lockfile/manifest drift, inconsistent pinning.
- Per migration candidate, estimate blast radius (files touched) — drives effort and whether to recommend at all.

## 7. DX & Tooling — label `DX`

- Missing/broken: typecheck script, lint config, formatter, pre-commit hooks, editorconfig.
- Slow feedback loops: dev-server/test startup in minutes, no watch mode, CI without caching.
- Onboarding friction: wrong/incomplete README setup, undocumented required env vars, no `.env.example`.
- **Agent-readability** (this workspace weights it heavily — see the `DX` label definition): naming, implicit contracts that aren't documented, overloaded sentinel columns without a guard comment, missing or stale `CLAUDE.md`/`AGENTS.md` sections for newly-added flows.
- Error messages/logging ergonomics: debugging that requires code changes.

## 8. Observability — label `Observability`

Logging, alerting, silent failures, error surfacing (this workspace's `Observability` label).

- Silent failures: caught errors that never surface to a user, a log, or an alert — the operation just no-ops.
- Missing structured logging / request IDs / correlation on services and crons.
- Unmonitored critical paths: the money and order-state crons (`place-auto-approved-orders`, `reconcile-production-payments`, `cleanup-stale-orders`, Stripe webhook) failing without a signal.
- No surfacing of partial failures (e.g. a quote poll timing out, a vendor dropping) to the user or to telemetry.
- Sentry/alerting gaps where a failure is user-impacting but invisible.

## 9. Docs — label `DX`

Lowest default priority — flag only where absence has a concrete cost:

- Public API surface (published packages) without reference docs.
- Architectural decisions nobody can reconstruct for actively-contested areas.
- Stale docs that are actively wrong (worse than missing) — setup steps, API examples that no longer compile, an `AGENTS.md` section describing a flow the code has moved past.

## 10. Direction — features & where to take this next — label `Feature`

Forward-looking: not what's broken, but what this codebase wants to become. **Grounding rule:** every suggestion must cite repo evidence — a suggestion that could apply to any project ("add dark mode", "add AI") is noise. Sources of grounded signal:

- **Unfinished intent**: TODO/FIXME clusters around one theme, flags never rolled out, stubbed modules, abandoned mid-feature work in git history (e.g. CON-107 fulfillment sync — `checkOrderStatus` exists with zero production callers).
- **Stated-but-undelivered**: README/roadmap/Linear-project promises with no code, CLI flags or config that are no-ops.
- **Surface asymmetries**: one-directional pairs (export without import, create without bulk-create, webhooks out but not in), CRUD minus one.
- **The adjacent possible**: capabilities the architecture makes disproportionately cheap (a public API one route file from the existing service layer).
- **Friction worth productizing**: things users evidently do by hand around the project.

Direction findings adapt the format: **Impact** is product/user value (who wants this, why now), **Confidence** reflects how grounded the evidence is. Strategy belongs to the maintainer; the advisor offers grounded options with honest trade-offs. Issues for selected direction findings are usually **spike/design** issues (investigate, prototype, define the API, list open questions), not build-everything issues — scope them that way and keep them in `Backlog` until the maintainer pulls them.

---

## Category → Linear label map

| Audit category | Linear label | Priority hint |
|---|---|---|
| Correctness / Bugs | `Bug` | by leverage |
| Security | `Bug` | Urgent / High |
| Performance | `Improvement` | by leverage |
| Test Coverage | `Improvement` | High if it unblocks risky work |
| Tech Debt & Architecture | `Improvement` (or `DX`) | Medium |
| Dependencies & Migrations | `Improvement` | by blast radius |
| DX & Tooling | `DX` | Medium / Low |
| Observability | `Observability` | High if a money/order path is blind |
| Docs | `DX` | Low |
| Direction | `Feature` | maintainer-chosen |

If a category genuinely has no home label, prefer the closest existing one and name the category in the issue title — **do not create new labels mid-run** without flagging it to the user first.

---

## Finding format

Every finding comes back in this shape:

```markdown
### [CATEGORY-NN] Short imperative title

- **Evidence**: `path/file.ts:123` — one-sentence description. (Repeat per location; 2–5 strongest, note "and ~N similar sites" if widespread.)
- **Impact**: What goes wrong / what's being paid. Concrete: "every order-list render issues 1+N queries", not "suboptimal".
- **Effort**: S (hours) / M (a day-ish) / L (multi-day) — for the *fix*, including tests.
- **Risk**: What the fix could break; LOW/MED/HIGH + one line why.
- **Confidence**: HIGH (read it, certain) / MED (strong signal, needs verification) / LOW (smell). LOW-confidence findings get an "investigate" issue, not a "fix" issue.
- **Fix sketch**: 1–3 sentences. Not the plan — just enough to judge effort honestly.
- **Label**: the Linear label from the map above.
```

## Prioritization rubric

Order by **leverage = impact ÷ effort, discounted by confidence and fix-risk**. Tiebreakers:

1. Anything that unblocks other findings (verification baseline, characterization tests) floats up.
2. HIGH-confidence security findings float above equivalent-leverage non-security findings.
3. Prefer findings whose fix has a clean verification story — light executors succeed at those.
4. "Not worth doing" is a valid verdict; record it with one line of reasoning in the run summary so it isn't re-audited.
