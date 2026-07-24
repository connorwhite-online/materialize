# Text-to-CAD knowledge base

Deep-dive documentation for the text-to-CAD harness and studio (codename **Prometheus**,
served at `/prometheus`, owner-gated via `lib/features.ts`). This directory is the durable
record of the July 2026 architecture review: what the system is today, why it behaves the
way it does, and the specs for where it goes next.

Written against commit `872ad9b` (2026-07-02). Every file:line pointer in these docs was
verified at that commit — executors should re-verify with a drift check before editing.

## Product thesis

The harness — not a bespoke model — is the product. An LLM writes parametric geometry
code, a sidecar executes and validates it, and a taste stack (design knowledge, exemplars,
concept images, a VLM judge) pushes the output from *plausible* to *designed*. The target
is **functional parts with out-of-the-box product-design taste** — not character
generation. The moat is not "an LLM writes CAD code" (replicable in a weekend); it is the
**verification and taste stack**: watertightness, network isolation, stress awareness,
DFM, a judged aesthetic bar, and a flywheel of proven exemplars. Generations must be
*trustworthy*, not just plausible.

Two root causes explain most current weaknesses; nearly every spec here attacks one of them:

1. **The harness cannot spend effort proportional to difficulty.** It is a scripted retry
   loop (4 attempts × 60s sidecar × 300s route, whole-script regeneration per attempt,
   silent lossy remesh fallback), not an agent that can decompose and iterate.
2. **The geometry representations cannot compose.** B-rep (build123d), implicit (sdf_kit),
   and mesh mode are mutually exclusive per generation, but real parts (e.g. a heat
   exchanger) need all of them in one artifact.

## Current architecture (map)

```
Studio (components/cad/text-to-cad-studio.tsx, 1651 lines, chat-style)
  └─ POST /api/cad/generate  (SSE stream, maxDuration=300, dies on disconnect)
       ├─ shouldUseGenerative() classifier → runGenerative()  (fal.ai Hunyuan3D, characters)
       └─ runHarness()  (lib/cad/harness.ts)
            ├─ conceptImage()      flux schnell render as aesthetic target (fresh builds)
            ├─ plan step           PLAN_SYSTEM_PROMPT, short design plan (fresh builds)
            ├─ generate            SYSTEM_PROMPT + knowledge block + exemplar + images
            ├─ runCadCode()        → cad-runner sidecar (FastAPI, fork/exec, 60s cap)
            │     modes: build123d B-rep | cadquery | mesh mode (numpy+marching cubes)
            │            | sdf_kit (functional skeleton + organic skin)
            │     fallback: voxel remesh at ~80³ when not watertight  ← silent quality loss
            ├─ gradeRun()          compiled/isSolid/isWatertight/isManifold (+dims for evals)
            ├─ judgeAesthetics()   VLM judge, 5 dims, PASS_THRESHOLD=75, OFF by default
            └─ repair loop         ≤4 attempts, full-script regeneration + targeted hint
       └─ persist (lib/cad/persist.ts)
            ├─ STL → R2 uploads/{userId}/{nanoid}/model.stl
            ├─ createDraftFileForPrint → files + file_assets rows (EVERY success)
            ├─ render PNG → R2 cad-renders/{userId}/{nanoid}.png  (never GC'd — known gap)
            └─ cadGenerations row: parent-pointer version chain, feedback, aestheticScore
```

Key files:

| Area | File |
| --- | --- |
| Harness loop | `lib/cad/harness.ts` |
| Prompts + grading (pure, shared with evals) | `lib/cad/prompt.ts` |
| Knowledge blocks (aesthetics/DFM/fasteners/ergonomics) | `lib/cad/knowledge/` |
| Exemplars (12, keyword-matched, sidecar-verified) | `lib/cad/knowledge/exemplars.ts` |
| Concept image (flux) | `lib/cad/concept.ts` |
| VLM judge | `lib/cad/critique.ts`, `lib/cad/critique-core.ts` |
| Generative mesh path (fal) | `lib/cad/generative.ts` |
| Model client (raw Messages API, per-role routing) | `lib/cad/model-client.ts`, `lib/cad/models.ts` |
| Execution sidecar | `cad-runner/app.py`, `cad-runner/sdf_kit.py` |
| Persistence | `lib/cad/persist.ts`, `app/actions/cad-generation.ts` |
| Streaming route | `app/api/cad/generate/route.ts` |
| Studio UI | `components/cad/text-to-cad-studio.tsx`, `app/(app)/prometheus/page.tsx` |
| Viewer + selection | `components/viewer/model-viewer.tsx`, `components/cad/studio-frame.ts` |
| Evals | `scripts/evals/`, `app/(app)/prometheus/eval/page.tsx` |
| Tier-2 topopt design doc (pre-existing) | `docs/text-to-cad-tier2-topology-optimization.md` |

## Workstream specs

Ordered by leverage-per-effort (the recommended sequencing). Each doc is written to be
cold-executable: current state with pointers, spec, acceptance criteria, open questions.

| # | Doc | One-liner | Linear |
| --- | --- | --- | --- |
| 01 | [selection-fidelity.md](./01-selection-fidelity.md) | Fix "optical" face/edge picking: feature-edge-bounded segmentation now, B-rep face identity export next | MTR-173, MTR-174 |
| 02 | [generation-jobs.md](./02-generation-jobs.md) | Generation as a resumable background job; remesh becomes a decision, not a silent fallback | MTR-175 |
| 03 | [agentic-harness.md](./03-agentic-harness.md) | Stateful sidecar sessions + tool-use loop + complexity-routed effort — the fix for "quits early and simplifies" | MTR-176 |
| 04 | [sdf-kit-v2.md](./04-sdf-kit-v2.md) | TPMS/gyroid primitives, B-rep↔SDF composition bridge, dual-network isolation verifier (heat-exchanger flagship) | MTR-177 |
| 05 | [lifecycle-versioning.md](./05-lifecycle-versioning.md) | First-class threads, studio-draft stage (library-invisible until save/print), version-the-design-not-the-generation, GC | MTR-178 |
| 06 | [design-brief-and-fea.md](./06-design-brief-and-fea.md) | Structured design-brief intermediate (components/keep-outs/interfaces) + cheap FEA-in-the-loop critique | MTR-179 |
| 07 | [taste-flywheel.md](./07-taste-flywheel.md) | Judge on by default, multi-view renders, exemplar retrieval + auto-harvest from rated generations | MTR-180 (extends MTR-170) |
| 08 | [monetization.md](./08-monetization.md) | Credits-in-subscription + BYOK: architecture and open decisions | MTR-181 (Needs Decision) |

This review itself is tracked as MTR-182.

Beyond the workstream specs, [09-cad-skills-research.md](./09-cad-skills-research.md)
(MTR-195, 2026-07-05) is a competitive deep-dive of CAD Skills
(earthtojake/text-to-cad): what it validates about this architecture, the gaps adopted
from it (MTR-196–201), and the fulfillment-rails strategic play (MTR-202).
[10-llm-cad-research-alignment.md](./10-llm-cad-research-alignment.md) (2026-07-24)
extends it with the academic frontier (Seek-CAD, GenCAD, cadbench.ai, and the
2023–26 landscape): the verdict on the editable-feature-timeline thesis, and a
prioritized cost package (prompt caching, prompt modularization, role routing) for
the harness. Its recommendations still need MTR issues filed.

Related pre-existing issues: MTR-35 (annotation v1, shipped — 01 is its v2), MTR-44
(assemblies 2/2), MTR-46 (enhancement backlog), MTR-48 (studio cleanups — superseded in
part by 05), MTR-50 (thumbnails), MTR-51 (production enablement — prerequisite for 02's
worker), MTR-157/158/159 (hardening, done), MTR-166–171 (health-pass findings).

## Known defects recorded during this review (small, fix opportunistically)

- `remeshed` is streamed to the client but **not persisted** (no column on
  `cad_generations`) — we cannot measure how often quality is silently degraded.
  Folded into doc 02.
- Render PNGs under `cad-renders/` are **never garbage-collected**; the orphan cron
  (`app/api/cron/cleanup-orphan-uploads/route.ts`) only sweeps `uploads/`, and
  `deleteCadBuild` leaves render objects behind. Folded into doc 05.
- A client disconnect (mobile tab background) **aborts a running generation**
  (`request.signal` is wired into the harness). Folded into doc 02.
- Smooth-tangent edges (e.g. a fillet's boundary) are **unselectable** in the annotation
  tool — `EdgesGeometry(25°)` cannot see edges with no dihedral angle. Folded into doc 01.
- The sidecar executes model-generated Python with the container as the only boundary
  (`cad-runner/app.py` header). Acceptable owner-only; **hard gate before any
  multi-user or BYOK exposure** (gVisor / seccomp / microVM). Referenced in docs 03 and 08.

## Glossary

- **B-rep** — boundary representation; what OpenCASCADE/build123d build. Crisp faces and
  edges, exports STEP, parametric and editable.
- **Mesh mode** — the script assigns a `trimesh.Trimesh` to `result` (implicit fields +
  marching cubes). No STEP; used for geometry a CSG kernel cannot express.
- **sdf_kit** — the sidecar's signed-distance-field toolkit ("Tier 1"): exact functional
  anchors (`cyl_z`, `box`) smooth-unioned (`smin`) with organic connecting bodies, then
  marching-cubed. This is the "drape organic skin over a functional skeleton" primitive.
- **Optical face** — the face a *user* perceives (the whole cylinder barrel, the whole
  fillet), as opposed to the ~5°-of-the-seed triangle patch the current picker selects.
- **Thread** — a chain of generations linked by `parentGenerationId`; reconstructed at
  read time today (no table), first-class in doc 05.
