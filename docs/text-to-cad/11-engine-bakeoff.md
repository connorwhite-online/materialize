# 11 — Engine bake-off: B-rep vs implicit

How to run the comparison between the two geometry engines, and how to read
what comes back.

## What is being compared

| | `brep` | `sdf` |
| --- | --- | --- |
| Front end | build123d on OpenCASCADE | `sdf_kit` fields + manifold3d booleans |
| Sidecar engine | `build123d` | `mesh` (no kernel warm import) |
| Exports | STL + STEP + topology | STL only |
| Prompt | `lib/cad/prompt.ts` | `lib/cad/engines/sdf-prompt.ts` |

Both run through the same harness loop — brief, concept, plan, repair, judge,
dimension checks, persistence. They differ in vocabulary and execution
target, not in how a generation is driven. That is what makes the comparison
about the representation rather than about two separate products.

## Why this exists

The premise was that generations fail after ~5 minutes on OpenCASCADE
fillet/boolean errors. Mining production said something more specific. Of 12
recorded failures:

- **4** were an error-swallowing bug in best-of-N, since fixed — they carried
  no diagnosis at all.
- **2** were orphaned jobs (one ran 7.2 hours), not deadline kills.
- **6** were real geometry failures, and every one was a loft, a spline blend,
  an organic enclosure, or a two-fluid core.

All twelve ran build123d. Not one reached the implicit path, because it was a
keyword-gated *section* of the build123d prompt rather than an engine. So the
question is narrower than "which kernel is better": **does the implicit
engine handle the requests that actually fail, and at what cost to the ones
build123d already handles well?**

## Running it

Needs a live sidecar **built from this branch** — the deployed image predates
`manifold3d` and `dfm.py`, and the bake-off requests DFM checks on every run.

```bash
# Validate prompt assembly first — a full run is 32 generations of model spend
npx tsx scripts/bench/run.ts --dry-run

CAD_RUNNER_URL=https://<sidecar> CAD_RUNNER_SECRET=... \
ANTHROPIC_API_KEY=... \
npx tsx scripts/bench/run.ts --out bench.json
```

Useful flags: `--engines brep,sdf`, `--cases id1,id2`, `--seeded` (only the
cases taken from real production failures), `--attempts N` (default 3),
`--concurrency N` (default 1 — the sidecar is the bottleneck).

The runner talks to the model and the sidecar directly and imports only pure
modules. It must never import the harness: that pulls `server-only` through
`@/lib/db` and the script dies at import. `scripts/cad-failure-miner.ts` is
still stuck in that trap and needs `NODE_OPTIONS=--conditions=react-server`.

## Reading the scorecard

**Success rate** is the headline, but read it with **median time to first
valid mesh** beside it. An engine that finishes in 90s where the other needs
700s wins by never reaching the deadline, and that difference does not show
up in a pass/fail column.

**Split by expected edge.** Every case declares, before the run, which engine
it is expected to favour. The set deliberately contains `brep` cases —
prismatic brackets, threaded bosses, gears, snap-fit assemblies — because a
set made only of organic prompts would prove nothing. If the implicit engine
loses those, that is the comparison working. A scorecard read without this
split can be made to say whatever the reader already believed.

**Model vs geometry time** separates "the LLM cannot write this" from "the
kernel cannot build this". They call for completely different fixes.

**DFM clean** is the share of *passing* runs that also clear minimum wall,
overhang and trapped-void checks. Watertight is a low bar; an engine that
produces valid-but-unprintable meshes has not actually won.

**Production-seeded block** is the sharpest single number: those prompts all
failed for real. Anything that now passes is a concrete recovery.

## Retiring the loser

Everything engine-specific is reachable from `lib/cad/engines/`:

- Implicit: `engines/sdf-prompt.ts`, the `SDF` profile in `engines/index.ts`,
  `cad-runner/sdf_kit.py`, and the exemplars `exemplarEngine()` classifies as
  `sdf`.
- B-rep: the `BREP` profile, `lib/cad/prompt.ts`, and everything topology- and
  STEP-related (`_export_topology`, feature chips, exact face picking).

Removing the implicit engine is a bounded deletion. Removing B-rep is **not**
symmetric, and that asymmetry should be explicit when the decision is made:
STEP export, the topology sidecar, exact face picking and the feature
timeline all depend on a B-rep kernel and have no implicit equivalent today.
An implicit win means accepting those losses, or keeping build123d as a
non-default path for the parts that need them.
