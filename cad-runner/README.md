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
uvicorn app:app --port 8000
```

Then point the app at it:

```
CAD_RUNNER_URL=http://localhost:8000
CAD_RUNNER_USE_MOCK=false
```

Leave `CAD_RUNNER_USE_MOCK` unset (or `true`) and the app uses an in-process
mock — no sidecar needed for local UI/pipeline work.

## Security

Executes model-generated Python. The **container** is the trust boundary:
deploy network-disabled, non-root (already set), read-only FS, with
memory/CPU caps. Per-run, `app.py` also forks a child with `RLIMIT_AS` /
`RLIMIT_CPU` and a wall-clock timeout. Adequate for the owner-only v0;
before public/multi-user exposure, move to a stronger sandbox (gVisor /
seccomp / per-run microVM). Optionally set `CAD_RUNNER_SECRET` (and the
matching env on the app) to require a bearer token.

Env knobs: `CAD_RUN_TIMEOUT_S`, `CAD_RUN_MEM_BYTES`, `CAD_RUN_CPU_S`,
`CAD_RUNNER_SECRET`.
