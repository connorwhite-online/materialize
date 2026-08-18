# 03 — Agentic harness: stateful sessions, tools, and effort routing

## Problem: the harness cannot "slowly figure it out"

The observed behavior — quitting early and remeshing on complex parts instead of working
through them — is architectural. The harness (`lib/cad/harness.ts:193-382`) is a scripted
retry loop:

- Each of ≤4 attempts **regenerates the entire script from scratch** given the error text
  and (when available) a render of the prior attempt. A failure on "step 7 of 9" throws
  away steps 1–6.
- The timeout/OOM repair hint literally instructs surrender (`harness.ts:182-184`):
  *"Drastically SIMPLIFY: far fewer boolean operations… the simplest geometry that still
  reads as the requested object."* For a genuinely complex part the right move is
  **decompose and build incrementally** — but the harness has no mechanism for that, so
  "simplify" is the only honest advice it can give itself.
- Every model call is a single completion with no tools (`lib/cad/model-client.ts` —
  deliberately raw Messages API per CON-174; the *transport* choice was right, the
  no-tools constraint is what we now outgrow).
- Effort is a constant (4 × 60s × 300s), independent of task difficulty.

## Spec

### A. Sidecar sessions (stateful kernel)

Add a session mode to `cad-runner` alongside the existing one-shot `/run`:

- `POST /session` → spawn a persistent child process (same limits pattern as
  `_apply_limits`) hosting a Python namespace with build123d/sdf_kit warmed. Returns
  `sessionId`. TTL ~10 min idle, hard cap ~30 min; `DELETE /session/:id`.
- `POST /session/:id/exec { code }` → exec in the persistent namespace, return the same
  per-shape payload as `/run` **when the code assigns/updates `result` or `parts`**, else
  just stdout/stderr + a namespace summary (defined variables of interesting types).
  Per-exec wall-clock cap stays ~60s — the point is that the *budget is per step, not
  per part*.
- `POST /session/:id/snapshot` / `rollback` → checkpoint the current `result` (export to
  a temp BRep/`.brep` file inside the child) so a failed step 7 can rewind to step 6
  instead of restarting. v1 can approximate this with "keep the last known-good `result`
  object under `_checkpoint`" entirely in-namespace.
- Security unchanged in kind (arbitrary Python, container boundary) but session mode
  extends process lifetime — same isolation caveats as `app.py`'s header; the gVisor/
  microVM hardening remains the gate for any non-owner exposure.

### B. Tool-use loop in the harness

New `runAgenticHarness` (sibling of `runHarness`, same `HarnessResult` contract so
`persistGenerationSuccess` and the route/worker don't change). An Anthropic tool-use loop
(streaming Messages API, `tool_use`/`tool_result` turns) with tools:

- `exec(code)` — session exec above; returns validation flags, geometry stats, and (when
  a solid exists) a render.
- `render(views?)` — re-render the current `result` from named viewpoints
  (`three-quarter | top | front | side | section-z`) — needs a small sidecar addition to
  `_render` to accept elev/azim/section params. Multiple views close the "one 3/4 view
  hides the defect" gap for both the agent and the doc-07 judge.
- `measure(query)` — bbox, wall-thickness sample at a point, distance between two
  named/located features (v1: bbox + volume + per-axis extents only).
- `grade()` — run `gradeRun` + (if enabled) the aesthetic judge on the current state.
- `finish()` — declare done; harness exports STL/STEP from the session and returns.
  **Gated (2026-08):** refused while the run that would actually ship (`bestRun`) fails
  the structural grade, misses the brief's dimension contract, or — for an
  exchanger-class prompt — carries no `check_networks` report; the refusal returns the
  outstanding list. Bounded by `MAX_FINISH_REFUSALS = 2`, after which finish() is honored
  and the result is flagged, because a gate that spends the whole budget arguing loses the
  part entirely. Only checks that RAN can block (honesty rail). The loop now also resolves
  its OWN brief on a fresh build (`resolveAgenticBrief`) — before that, `dimensionTargets`
  was empty on the orchestrate path and the gate would have had nothing to check.

System prompt: the existing `SYSTEM_PROMPT` rules + knowledge block + exemplar machinery
(`buildKnowledgeBlock`, `selectExemplars`) carry over verbatim — the *taste* stack is
orthogonal to the *control* change. Add loop guidance: build incrementally (base form →
features → shell → fillets), validate after each meaningful step, prefer fixing the last
step over restarting, snapshot before risky ops (large fillets, shells, booleans).

Budget: token + wall-clock caps enforced by the loop (count output tokens per turn;
stop + best-effort `finish()` near the cap). Telemetry per role extends the existing
`telemetry` array (`harness.ts:79`).

### C. Complexity routing

The cheap loop is *fine* for simple parts — don't pay agentic overhead for a 20mm cube.

- Extend the existing router pattern (`shouldUseGenerative`, `lib/cad/generative.ts:74-95`)
  to a three-way classification: `simple | complex | organic-character`. One cheap model
  call; the `plan` role's model. When in doubt → `simple` (the current loop remains the
  default and the fallback on any session/agent failure).
- `simple` → `runHarness` as today. `complex` → `runAgenticHarness` with a budget tier.
  `organic-character` → `runGenerative` (unchanged).
- Env kill switch `CAD_AGENTIC=false` reverts everything to the current loop.

### D. Remesh becomes a genuine choice (completes doc 02-C)

Inside the agentic loop, a non-watertight terminal state is a decision point the model
answers explicitly: fix the code / decompose into `parts` / accept a remesh (tool
`accept_remesh()` triggers the sidecar's voxel fallback deliberately). The decision and
reason land in telemetry.

## Acceptance

- An eval-set prompt that today exhausts 4 attempts and returns remeshed-or-failed (the
  `mechanical`/`assembly` tiers in `scripts/evals/cases.ts` are the hunting ground)
  completes clean via the agentic path, building incrementally across >4 execs.
- A deliberately-failing step (fillet radius too large) is repaired without regenerating
  the preceding steps (observable in session exec history).
- `simple` prompts show no latency/cost regression (router sends them down the old path).
- Kill switch verified: `CAD_AGENTIC=false` produces byte-identical behavior to today.

## Open questions

1. Session transport for serverless: sessions require the worker from doc 02 (a
   serverless function can't hold a session across invocations affordably). **Hard
   dependency: doc 02 lands first (worker option 2).**
2. Does the plan step survive? Probably yes as the agent's first turn ("write your plan,
   then start building") rather than a separate completion.
3. Model routing: `implement` vs `repair` roles collapse into one agent conversation;
   keep `CAD_MODEL_*` envs working by mapping the agent to the `implement` role.
4. How renders enter the conversation: every exec (expensive tokens) vs on-request via
   `render()` (agent may forget to look). Default: auto-attach after execs that change
   `result`, throttled to every other exec.

## Dependencies

- **Doc 02** (worker) — hard prerequisite for sessions.
- Doc 01 phase 2 pairs well: semantic annotations make revision turns dramatically more
  tractable for the agent.
- Docs 04/06 add tools to this loop (`check_networks`, `fea_probe`) — design the tool
  registry so they bolt on.
