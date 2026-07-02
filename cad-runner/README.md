# CAD runner sidecar

Isolated execution service for Materialize text-to-CAD. Runs a generated
build123d script and returns exported files + a preview render + geometry
stats + validity flags. Consumed by `lib/cad/runner-client.ts`.

This is a **separate service** from the Next.js app (Vercel's serverless
runtime can't run the OpenCASCADE kernel binary or a long-lived process),
so it deploys as its own container.

## Contract

`POST /run` with `{ "code": "<build123d python>", "formats": ["stl","step"] }`.

The script must assign its final solid to a variable named `result`. The
response shape matches `CadRunResult` in `lib/cad/types.ts`.

`GET /health` → `{ "ok": true }`.

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

Env knobs: `CAD_RUN_TIMEOUT_S`, `CAD_RUN_MEM_BYTES`, `CAD_RUN_CPU_S`,
`CAD_RUNNER_SECRET`, `CAD_RUNNER_ALLOW_NO_AUTH`.
