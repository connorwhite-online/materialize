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

## Deploy to Railway (production enablement — MTR-51)

`railway.toml` (next to this file) drives the deploy. Create a service from
this repo and **set its Root Directory to `cad-runner`** — that's the only
manual setting; Railway then builds the Dockerfile and healthchecks `/health`
(300s timeout, on-failure restart). The container binds Railway's injected
`$PORT` (Dockerfile `CMD`), so no port config is needed.

**Wire the two sides** (this is the whole "run it in production" step — the env
vars the owner enters, one set on each side):

- On the **Railway service**:
  - `CAD_RUNNER_SECRET=<long random token>` — **required; the service fails to
    boot without it** (fail-closed, `app.py`). This is the bearer token the app
    authenticates with. Prefer `CAD_RUNNER_SECRET_FILE=<path>` (a file-mounted
    secret) when the platform supports it — a file secret never enters the
    process environment, so it can't leak via `/proc/*/environ` (see Security).
  - Leave `CAD_RUNNER_USE_MOCK` unset/false.
  - Optional resource-cap tuning (all have safe defaults — set only to tighten):
    per-exec `CAD_RUN_TIMEOUT_S` / `CAD_RUN_MEM_BYTES` / `CAD_RUN_CPU_S`;
    per-session `CAD_SESSION_CPU_S` / `CAD_SESSION_MAX_EXECS` /
    `CAD_SESSION_MAX_OUTPUT_BYTES` / `CAD_SESSION_TTL_S` / `CAD_SESSION_MAX`;
    per-artifact `CAD_MAX_OUTPUT_BYTES`.
  - **Harden the runtime** (the container is the trust boundary — see Security):
    restrict egress (the sidecar needs no outbound network), and where the
    platform exposes them set a read-only root FS + tmpfs `/tmp`,
    `cap-drop=ALL`, and `no-new-privileges`. The Dockerfile is written so a
    read-only root FS works (every writable path is under `/tmp`). Give it
    generous memory — CAD runs are RAM-hungry.
- On the **Vercel app**: `CAD_RUNNER_URL=https://<service>.up.railway.app` and
  `CAD_RUNNER_SECRET=<same token>` (Settings → Environment Variables). Also set
  `TEXT_TO_CAD_ENABLED=true` + `TEXT_TO_CAD_ALLOWED_EMAILS` to expose the studio
  to the allowlist, `ANTHROPIC_API_KEY` for the model path, and confirm the
  Vercel plan allows the generate route's `maxDuration = 300`.

**⚠️ Redeploy Railway on every `cad-runner/**` change.** The sidecar is a
separate service from the Vercel app: a Vercel deploy does NOT rebuild the
Railway image. Recent PRs changed `app.py` / `Dockerfile` / `requirements.txt`
without a running sidecar picking them up. After merging a `cad-runner/**`
change, trigger a Railway redeploy (or enable branch auto-deploy). CI
(`.github/workflows/cad-runner-tests.yml`) verifies the code on every such PR,
but only a Railway rebuild ships it.

The model path (MTR-51 blocker #2) is already resolved: `lib/cad/model-client.ts`
calls the Anthropic Messages API directly (`@anthropic-ai/sdk`, CON-174), not the
Agent SDK subprocess — set `ANTHROPIC_API_KEY` and it runs on serverless. Only
the sidecar-hosting half above remained.

Migration `0043` (`cad_generations.project_id`) applies automatically on the
Vercel build (`npm run db:migrate`). Optional generation backends stay inert
until their keys are set: `FAL_KEY`, `CAD_AESTHETIC_JUDGE=true`.

## Security

Executes model-generated Python. **This is defense-in-depth, NOT a sandbox.**
The **container is the trust boundary** — deploy it egress-restricted, non-root
(already set), read-only root FS + tmpfs `/tmp`, `cap-drop=ALL`,
`no-new-privileges`, with memory/CPU caps. The in-process controls below make
the common attacks fail loudly and bound resource abuse, but a determined script
with raw ctypes/libc primitives can still bypass Python-level controls; only the
container (and, before non-owner access, gVisor/seccomp/microVM) truly contains
it. **This hardening is sized for the owner-only allowlist; MTR-187 remains the
blocking gate before any non-owner or BYOK access** (see "The real gate" below).

`CAD_RUNNER_SECRET` is **required** — the service **fails to boot** without it,
so a misconfigured deploy can't become an unauthenticated code-execution
endpoint. `CAD_RUNNER_SECRET_FILE=<path>` is the hardened alternative (keeps the
secret out of the environment). The only no-auth exception is
`CAD_RUNNER_ALLOW_NO_AUTH=true`, a dev override for local runs — never on a
deployed service.

### In-container hardening (MTR-187)

Layered controls, each verified by the adversarial suite
(`tests/test_adversarial.py`, 16/16 against a live sidecar; the 23 build123d
exemplars + bd_warehouse smoke still pass, so none of this breaks real CAD):

1. **Pre-exec AST source guard** (`validate.py`, `CAD_AST_VALIDATE`, default on)
   — rejects a script that won't parse or that *statically* imports an obvious
   egress/process-spawn module (`socket`, `subprocess`, `requests`, `urllib`,
   `ctypes`, …). Cheap, but bypassable by obfuscating the import.

2. **Runtime egress/spawn block (PEP-578 audit hook)** — installed in the child
   after the trusted kernel warm, before untrusted code. Blocks
   `socket.connect`/`bind`/`getaddrinfo`, `subprocess.Popen`,
   `os.system`/`exec`/`spawn` at the interpreter level, so it fires *even when
   the import is obfuscated past the AST guard* (`__import__("socket")`,
   `importlib`, aliasing). This closes the "one-line bypass" the AST guard
   concedes. Residual: raw ctypes→libc syscalls are not audited.

3. **Runner-secret scrub** — `CAD_RUNNER_SECRET` and secret-named vars are
   removed from the child's `os.environ` before untrusted code runs, so a script
   can't read the secret and return it via stdout. **Residual:** `del
   os.environ[...]` does not rewrite `/proc/self/environ` (Linux keeps the
   process's initial-stack copy), so a secret passed as an env var is still
   readable there — use `CAD_RUNNER_SECRET_FILE` to keep it out of the
   environment entirely, and don't put other secrets in the sidecar's env (it
   needs none).

4. **Per-session cumulative resource caps** (not just per-exec) — a session child
   lives up to `CAD_SESSION_TTL_S`, so per-exec limits alone let abuse
   accumulate. Now bounded per session: CPU via a **hard** `RLIMIT_CPU`
   (`CAD_SESSION_CPU_S`, kernel SIGKILL), plus `CAD_SESSION_MAX_EXECS` and
   `CAD_SESSION_MAX_OUTPUT_BYTES` enforced in the worker; `CAD_MAX_OUTPUT_BYTES`
   caps a single artifact (output-flood bomb). Per-child `RLIMIT_AS` bounds
   memory. A runaway child dies without taking the service down.

5. **Output-path ownership** (audited) — generated code never chooses a
   filesystem destination. Every export/`open()` is rooted in a harness-owned
   `tempfile.TemporaryDirectory`; the single-`result` stem is the literal
   `"model"` and per-part stems are sanitized to `[A-Za-z0-9-]`, so a `parts`
   key cannot contain a path separator or `..` and cannot escape the temp dir.

6. **Cross-session temp isolation (temporal)** — each session gets a private
   `0700` temp tree (`TMPDIR`), removed on close, so a *finished* session's temp
   files can't be read by a later one. **Residual:** all session children run as
   the same uid, so two *concurrent* sessions are NOT isolated from each other's
   temp files — that needs distinct uids / a namespace (the gVisor/microVM gate).

### The real gate (still open — MTR-187)

The container is a single trust boundary, not a per-run/per-session sandbox.
gVisor (runsc) / seccomp + microVM-grade isolation, distinct-uid-or-namespace
per session, and runner-secret rotation remain **required before any non-owner
or BYOK access**. Railway can't provide microVM/gVisor isolation today, so that
decision is filed on MTR-187 (stay on Railway + this hardening for the owner-only
allowlist; move to Fly Machines / self-hosted for gVisor/Firecracker when the
studio opens beyond the owner). The controls above are a cheap complement, not a
substitute.

Env knobs: `CAD_RUN_TIMEOUT_S`, `CAD_RUN_MEM_BYTES`, `CAD_RUN_CPU_S`,
`CAD_SESSION_CPU_S`, `CAD_SESSION_MAX_EXECS`, `CAD_SESSION_MAX_OUTPUT_BYTES`,
`CAD_MAX_OUTPUT_BYTES`, `CAD_RUNNER_SECRET`, `CAD_RUNNER_SECRET_FILE`,
`CAD_RUNNER_ALLOW_NO_AUTH`, `CAD_AST_VALIDATE`, `CAD_VOXEL_FALLBACK`,
`CAD_VOXEL_RES`, `CAD_SESSION_TTL_S`, `CAD_SESSION_MAX`.

## Tests

CI runs these on every `cad-runner/**` PR (`.github/workflows/cad-runner-tests.yml`)
— the sidecar deps are plain-pip-installable on x86_64 Linux (MTR-51), so CI
exercises the real OpenCASCADE kernel without a Docker build:

- `python3 cad-runner/tests/run_tests.py` (sdf_kit/networks/fea kernel contracts)
- `python3 cad-runner/tests/test_validate.py` (pre-exec source guard, stdlib only)
- `python3 cad-runner/tests/test_fit.py` (fit contract, MTR-204)
- `python3 cad-runner/tests/test_adversarial.py` (**MTR-187 adversarial proof
  suite** — network egress, obfuscated egress, DNS, subprocess, `os.system`,
  secret scrub, `/proc` probing, cross-session namespace + temp isolation,
  CPU/memory/output bombs, `parts`-name path traversal, per-session exec +
  cumulative-CPU caps; every case must be blocked or bounded)
- `python3 cad-runner/tests/test_bd_warehouse_smoke.py` (MTR-200 standard-part
  constructors; SKIPs cleanly where OCP is absent)

`python3 cad-runner/tests/test_app.py` (HTTP layer: /run flags, renders, checks,
sessions — engine `"mesh"` only) runs as an **informational** CI step: two of
its mesh-mode assertions (hollow-part section cutaway, two-cavity marching-cubes
body count) are sensitive to numpy/trimesh *patch* versions and can flake in a
freshly pip-resolved env; the flagship kernel contracts in `run_tests.py` cover
the same machinery deterministically, and the B-rep/topo paths run only in the
container image.
