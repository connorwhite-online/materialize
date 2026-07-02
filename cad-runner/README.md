# CAD runner sidecar

Isolated execution service for Materialize text-to-CAD. Runs a generated
CAD script and returns exported files + preview renders + geometry
stats + validity flags. Consumed by `lib/cad/runner-client.ts` (one-shot)
and `lib/cad/session-client.ts` (sessions).

This is a **separate service** from the Next.js app (Vercel's serverless
runtime can't run the OpenCASCADE kernel binary or a long-lived process),
so it deploys as its own container.

## Contract

`POST /run` with `{ "code": "<python>", "formats": ["stl","step"], "engine",
"allowRemesh", "checks" }`.

The script must assign its final solid to a variable named `result` (or a
`parts` dict for assemblies). The response shape matches `CadRunResult` in
`lib/cad/types.ts`.

- **`engine`** — `"build123d"` (default) or `"cadquery"` (B-rep, OpenCASCADE),
  or `"mesh"`: pure numpy/trimesh/`sdf_kit` scripts with no CAD kernel.
  `"mesh"` skips the kernel warm import, requires `result` to be a
  `trimesh.Trimesh`, and can't export STEP (no B-rep).
- **`allowRemesh`** (default `false`) — the lossy voxel-remesh fallback for a
  non-watertight result is a *decision*, not a silent default
  (docs/text-to-cad/02 §C). Without it, an unclosable mesh fails with a
  diagnosis (euler number, open-boundary face count) the repair loop can act
  on. `CAD_VOXEL_FALLBACK=false` stays the global kill switch on top.
- **Renders** — `renders: { threeQuarter, top, front, side }` (base64 PNGs;
  the extra views are smaller), with `renderPng` kept as the threeQuarter
  view for compatibility (docs/text-to-cad/07 §A). Assemblies get one render
  per part only — payload size.
- **`checks`** (optional, MTR-179/180) — post-export probes on the produced
  mesh, attached as `checks` in the payload; each is failure-isolated
  (`{"error": ...}` instead of a failed run):
  `{"networks": {"ports": [{name, point, r}, ...]}}` → void-network isolation
  (`networks.check_networks`); `{"fea": {"loads", "supports", "resolution"}}`
  → coarse comparative voxel FEA (`fea.fea_probe`).
- **`formats: [..., "topo"]`** (best-effort, MTR-174) — for B-rep engines,
  also emit a `topo` payload: per-face tessellation identity (`faces` with
  surface type/params and `triRange` into the shipped STL's triangle list,
  `edges` with polylines + adjacent face ids) for exact viewer picking. The
  STL is built from that same tessellation so `triRange` indexes it. On any
  failure `topo` is simply omitted. Mesh-mode results never have it.

`GET /health` → `{ "ok": true }`.

## Sessions (agentic loop, docs/text-to-cad/03 §A)

A persistent child process holding ONE Python namespace across execs, so the
harness can build a part incrementally with a per-*step* (not per-part)
timeout. Same bearer auth as `/run`. Protocol pinned by
`lib/cad/session-client.ts`:

- `POST /session {engine?}` → `{"sessionId"}`. Kernel warmed per engine
  (skipped for `"mesh"`). At most `CAD_SESSION_MAX` (default 4) live
  sessions — beyond that, 429. Idle sessions expire after `CAD_SESSION_TTL_S`
  (default 600), swept lazily on session calls.
- `POST /session/{id}/exec {code, formats?, allowRemesh?, checks?}` — exec in
  the persistent namespace under the `CAD_RUN_TIMEOUT_S` wall clock. If
  `result`/`parts` is present afterwards, replies with the full `/run`
  payload plus `stdout` + `namespace` (non-dunder variable names); otherwise
  `{ok, stdout, namespace}`. A timeout kills the child: that exec returns the
  `/run` timeout error shape and subsequent calls on the session get 410.
- `POST /session/{id}/snapshot` / `rollback` — checkpoint / restore `result`
  in-namespace (copy semantics for trimesh), so a failed step rewinds instead
  of restarting.
- `DELETE /session/{id}` → terminate + cleanup.

## Run locally

```bash
cd cad-runner
pip install -r requirements.txt
CAD_RUNNER_ALLOW_NO_AUTH=true uvicorn app:app --port 8000
```

(The runner now fails to boot without `CAD_RUNNER_SECRET`; the override above
is fine for a local, non-public run. Set `CAD_RUNNER_SECRET` instead if you
want to exercise the auth path locally.)

Then point the app at it:

```
CAD_RUNNER_URL=http://localhost:8000
CAD_RUNNER_USE_MOCK=false
```

Leave `CAD_RUNNER_USE_MOCK` unset (or `true`) and the app uses an in-process
mock — no sidecar needed for local UI/pipeline work.

## Deploy to Railway

`railway.toml` (next to this file) drives the deploy. Create a service from
this repo and **set its Root Directory to `cad-runner`** — that's the only
manual setting; Railway then builds the Dockerfile and healthchecks `/health`.
The container binds Railway's injected `$PORT` (Dockerfile `CMD`), so no port
config is needed.

Then wire the two sides:

- On the **Railway service**: `CAD_RUNNER_SECRET=<long random token>`. Restrict
  egress — this service needs no outbound network. Give it generous memory.
- On the **Vercel app**: `CAD_RUNNER_URL=https://<service>.up.railway.app`,
  `CAD_RUNNER_SECRET=<same token>`, and leave `CAD_RUNNER_USE_MOCK` unset/false.

Migration `0043` (`cad_generations.project_id`) applies automatically on the
Vercel build (`npm run db:migrate`). Optional generation backends stay inert
until their keys are set: `FAL_KEY`, `CAD_AESTHETIC_JUDGE=true`.

## Security

Executes model-generated Python. The **container** is the trust boundary:
deploy network-disabled, non-root (already set), read-only FS, with
memory/CPU caps. Per-run, `app.py` also forks a child with `RLIMIT_AS` /
`RLIMIT_CPU` and a wall-clock timeout. Adequate for the owner-only v0;
before public/multi-user exposure, move to a stronger sandbox (gVisor /
seccomp / per-run microVM).

`CAD_RUNNER_SECRET` is **required** (and the matching env must be set on the
app) to authenticate the bearer token — the service **fails to boot** without
it. The only exception is `CAD_RUNNER_ALLOW_NO_AUTH=true`, an explicit dev
override for local/no-public-URL runs; never set it on a deployed service.

Session mode extends child-process lifetime but not the threat model — the
container boundary is still what contains generated code.

Env knobs: `CAD_RUN_TIMEOUT_S`, `CAD_RUN_MEM_BYTES`, `CAD_RUN_CPU_S`,
`CAD_RUNNER_SECRET`, `CAD_RUNNER_ALLOW_NO_AUTH`, `CAD_VOXEL_FALLBACK`,
`CAD_VOXEL_RES`, `CAD_SESSION_TTL_S`, `CAD_SESSION_MAX`.

## Tests

`python3 cad-runner/tests/run_tests.py` (sdf_kit/networks/fea contracts) and
`python3 cad-runner/tests/test_app.py` (HTTP layer: /run flags, renders,
checks, sessions — engine `"mesh"` only, since the dev env has no CAD
kernel; the B-rep/topo paths run only in the container image).
