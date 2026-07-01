# Linear Issue Template (cold-executable)

Every issue is written for an executor agent with **zero context**: it has not seen the advisor session, the audit, the other issues, or any prior conversation. It is likely a smaller/cheaper model — competent at following explicit instructions, weak at filling gaps or knowing when to stop.

Three properties make an issue executable by a weaker model:

1. **Self-contained** — everything is in the body: paths, code excerpts, conventions, commands. The executor reads the issue from Linear (via `get_issue`) and the repo. Nothing else.
2. **Verification gates** — every step ends with a command and its expected result. The executor never has to *judge* whether it succeeded.
3. **Hard boundaries & escape hatches** — explicit out-of-scope list, and "STOP and report" conditions instead of letting a small model improvise.

> Adapted from shadcn/improve's plan-template (MIT). `plans/*.md` files → Linear issues; the body IS the plan.

---

## Linear metadata (set via `save_issue`)

| Field | Value |
|---|---|
| **Team** | `Materialize` (key `MTR`) |
| **Project** | the matching feature/cross-cutting project (Print Quote Pipeline, Checkout Payments & Order Lifecycle, Agent Orders & MCP, Text-to-CAD Studio, Marketplace, Creator Tools, Accounts/Profiles/Orgs, 3D Viewer & Rendering, Testing & E2E, Observability & Ops, Platform: Infra DevX & Environment) — or the repo being audited |
| **State** | `Todo` if ready to execute now; `Backlog` if blocked on a dependency or a maintainer decision (direction/spike issues) |
| **Label** | from the category→label map in the playbook |
| **Priority** | Urgent / High / Medium / Low, from leverage (security HIGH → at least High) |
| **Estimate** | optional; map S→1, M→2–3, L→5 if the team uses points |
| **Relations** | `blocked by` the issue(s) it depends on (Linear relation) — *and* restate in the body |
| **Title** | imperative, what's true after: "Batch the per-item quote fetch in cart re-pricing" |

Keep the **title** specific and outcome-shaped — it's what the maintainer scans. Put a category tag only if the label doesn't already carry it.

---

## Issue body template

```markdown
> **Executor instructions**: Follow this issue step by step. Run every
> verification command and confirm the expected result before the next step.
> Touch only the files listed in scope. If any STOP condition occurs, stop
> and report on the issue — do not improvise. Open a PR whose description
> contains `MTR-NNN` so it links here. Do not merge.
>
> **Drift check (run first)**: `git diff --stat <Planned-at SHA>..HEAD -- <in-scope paths>`
> If any in-scope file changed since this issue was written, compare the
> "Current state" excerpts to the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: Urgent | High | Medium | Low
- **Effort**: S | M | L
- **Risk**: LOW | MED | HIGH
- **Depends on**: MTR-NNN (or "none") — do not start until that issue is Done
- **Category**: bug | security | perf | tests | tech-debt | migration | dx | observability | docs | direction
- **Planned at**: commit `<short SHA>`, <YYYY-MM-DD>

## Why this matters

2–5 sentences: the problem, its concrete cost, and what improves when this
lands. Intent is what lets a correct judgment call happen when a detail is off.

## Current state

The facts the executor needs, inlined — never "as discussed" or "see audit":

- Relevant files, each with one line on its role:
  - `components/print/cart-context.tsx` — cart re-pricing; the N+1 at lines 230–240
- Excerpts of the code as it exists today (short, with `file:line` markers),
  enough to confirm the executor is looking at the right thing.
- Repo conventions that apply, with one exemplar file: "Server actions follow
  the pattern in `app/actions/files.ts` — match it." Reference AGENTS.md
  sections by name when a documented contract governs this code (e.g. the
  overloaded-sentinel-column rule, the CON-153 consumer checklist).
- Any documented vocabulary / design constraint the work must honor — quote
  the specific lines; the executor has not read AGENTS.md.

## Commands you will need

| Purpose   | Command            | Expected on success |
|-----------|--------------------|---------------------|
| Install   | `npm install`      | exit 0              |
| Build/typecheck | `npm run build` | exit 0, no errors (the real pre-commit gate) |
| Tests     | `npx vitest run <filter>` | all pass     |

(Exact commands verified during recon, not guessed.)

## Scope

**In scope** (the only files you may modify):
- `components/print/cart-context.tsx`
- `components/print/__tests__/cart-context.test.tsx` (create)

**Out of scope** (do NOT touch, even though they look related):
- `components/print/poll-quotes.ts` — shared polling invariant; changing it
  risks the quote-configurator. Out of scope here.

## Git & PR workflow

- Branch: `claude/MTR-NNN-<slug>` off the default branch.
- Commit per logical unit; match the repo's commit style (see `git log`).
- Open **one PR** for this issue; PR description must contain `MTR-NNN`.
- Do NOT merge, and do NOT push to a protected branch.

## Steps

### Step 1: <imperative title>
Precise actions, exact files/symbols, the target code shape when load-bearing.
**Verify**: `<command>` → <expected output>

### Step 2: ...
(Each step small enough to verify independently. Order so the codebase is
never broken between steps — add new path, switch callers, remove old path.)

## Test plan

- New tests, in which file, covering which cases (happy path, the specific
  regression this fixes, named edge cases).
- Existing test to model after: "follow `app/actions/__tests__/files.test.ts`".
- Verification: `npx vitest run <filter>` → all pass, including N new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run build` exits 0
- [ ] `npx vitest run` passes; new tests for <X> exist and pass
- [ ] `grep -rn "<old pattern>" <dir>` returns no matches (if applicable)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] A PR is open referencing MTR-NNN

## STOP conditions

Stop and report on the issue (do not improvise) if:

- The code at "Current state" doesn't match the excerpts (drift).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.
- You discover the assumption "<key assumption>" is false.

## Maintenance notes

- What future changes will interact with this.
- What a reviewer should scrutinize in the PR.
- Any follow-up deliberately deferred (and why).
```

---

## Quality bar — check before filing each issue

- Could a model that has never seen this repo execute this with only the issue body and the repo? If a step needs advisor-session knowledge, inline it.
- Is every verification a command with an expected result, not a judgment ("make sure it works")?
- Does every step name exact files and symbols, not "the relevant module"?
- Are STOP conditions specific to this issue's real risks, not boilerplate?
- Would a reviewer reading only "Why this matters" + "Done criteria" understand what they're approving?
- No secret values anywhere — locations and credential types only.
- "Planned at" SHA filled; in-scope paths in the drift check match the Scope section.
- Dependencies set as Linear relations **and** restated in the body.
