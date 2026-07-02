# 02 — Generation as a resumable background job; remesh as a decision

## Problem

Generation runs entirely inside one HTTP request (`app/api/cad/generate/route.ts`,
`maxDuration = 300`), streaming SSE directly from the in-request harness loop. Three
consequences:

1. **Hard effort ceiling.** 300s route budget and a 60s sidecar cap
   (`CAD_RUN_TIMEOUT_S`, `cad-runner/app.py:43`) bound what any generation can attempt.
   The complex-part strategies in doc 03 (incremental sessions) and doc 06 (FEA) and the
   Tier-2 topopt plan (minutes-scale solves) all exceed this envelope. The pre-existing
   topopt doc reaches the same conclusion independently ("needs an async worker / job
   queue, not the lightweight per-request sidecar").
2. **Tab-close kills the work.** The harness receives `request.signal`
   (`route.ts:152,161`); a client disconnect aborts mid-generation. On mobile,
   backgrounding a tab long enough drops the SSE connection — the user returns to a
   failed build they paid model-tokens for.
3. **The lossy fallback is silent and unaccountable.** When a mesh isn't watertight, the
   sidecar voxel-remeshes at ~80 cells/axis (`app.py:180-208`) — destroying crisp
   features and forfeiting STEP — before the harness ever sees the result. `gradeRun`
   then passes it. The `remeshed` flag reaches the UI banner but is **not persisted**
   (no column), so we can't even measure how often quality is being traded away.

## Spec

### A. Job model

New table `cadJobs` (or reuse/extend `cadGenerations` — see open question 1):

- `id`, `generationId` (FK), `status` (`queued | running | done | failed | cancelled`),
  `progress` (jsonb array of `CadProgressEvent`, append-only), `startedAt`, `finishedAt`,
  `cancelRequestedAt`.
- `POST /api/cad/generate` becomes: insert `cadGenerations` row (as today) + `cadJobs`
  row, kick the worker, return `{ generationId, jobId }` immediately.
- Progress endpoint: `GET /api/cad/jobs/[id]/events` — SSE that replays persisted events
  then tails new ones (poll the row or LISTEN/NOTIFY). The client can disconnect and
  reconnect freely; `sessionStorage` resume in the studio
  (`components/cad/text-to-cad-studio.tsx:126-163`) reattaches to a live job instead of
  giving up after its 2-minute grace window.
- Cancellation: an explicit `POST /api/cad/jobs/[id]/cancel` sets `cancelRequestedAt`;
  the worker checks it between attempts (replacing the implicit disconnect-abort).
  Client disconnect no longer cancels anything.

### B. Worker

Where the loop actually runs. Options, in order of least new infrastructure:

1. **Vercel background function** invoked fire-and-forget from the route (still bounded
   by plan limits, but decoupled from the client connection). Adequate for the current
   ≤4-attempt loop.
2. **The sidecar host runs the worker too** (Railway — `cad-runner/railway.toml` already
   exists): a small queue consumer next to the runner, polling `cadJobs`. No serverless
   time limits at all; the natural home once doc 03 sessions and topopt land. Requires
   giving the worker DB + R2 + Anthropic credentials (it currently has none — decide
   whether the worker calls back into a Next.js internal API instead of talking to the
   DB directly; the callback pattern keeps credentials in one place).

Recommendation: ship (1) as the incremental step only if it's genuinely quick; otherwise
go straight to (2) — every later workstream wants it, and MTR-51 (production enablement)
already requires standing up the Railway host.

### C. Remesh becomes a decision

- Sidecar: move the voxel fallback behind a request flag (`allowRemesh: false` by
  default). When repair fails and the mesh is still open, return the diagnosis
  (`isWatertight: false`, hole count/size from trimesh) *without* remeshing.
- Harness: on a non-watertight result with attempts remaining → repair turn (as today).
  On the **last** attempt → re-run the sidecar with `allowRemesh: true` and accept the
  remeshed result, but record it. The agentic loop in doc 03 upgrades this to a genuine
  choice (fix code vs accept vs decompose); this doc only makes the trade explicit and
  measurable.
- Persist: add `remeshed boolean not null default false` to `cad_generations`; set from
  `result.run.remeshed` in `persistGenerationSuccess`/`persistAssembly`
  (`lib/cad/persist.ts`). Surface on the eval scorecard (remesh rate per tier is a
  quality KPI — today it's invisible).

### D. Event contract

`CadProgressEvent` (`lib/cad/types.ts:63-85`) stays the wire format; events are now also
rows in `cadJobs.progress`. Add one event type: `{ type: "queued" }`. The studio's
`ProgressPanel` (`text-to-cad-studio.tsx:1463-1505`) shows only the latest event — no UI
change beyond the reconnect path.

## Acceptance

- Kill the tab mid-generation; reopen `/prometheus` → the build resumes streaming and
  completes. The `cadGenerations` row never records a spurious failure.
- `SELECT count(*) FROM cad_generations WHERE remeshed` returns a real number; the eval
  scorecard shows remesh rate.
- A generation with `allowRemesh: false` that can't close returns a failed grade with the
  hole diagnosis in `error`, and the repair prompt contains it.
- No path regresses the local-dev no-credentials demo mode (mock runner + fake model).

## Open questions

1. Separate `cadJobs` table vs columns on `cadGenerations`? Separate table keeps the
   generation row immutable-ish and supports future multi-job generations (topopt solve +
   verify as sibling jobs); columns are less plumbing. Default: separate table.
2. Worker credential model (direct DB vs callback API). Default: callback API
   (`POST /api/internal/cad/...` with a shared secret), mirroring the runner-secret
   pattern (`CAD_RUNNER_SECRET`).
3. Retention of `progress` jsonb (it's per-attempt event spam) — cap the array or prune
   on completion to the terminal event + validation summaries.

## Dependencies

- MTR-51 (host the sidecar) if worker option 2 is chosen.
- Doc 03 builds directly on this (sessions need the unbounded worker).
- Doc 05's GC should include failed/orphaned job rows.
