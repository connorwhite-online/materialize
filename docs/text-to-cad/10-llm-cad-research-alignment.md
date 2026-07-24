# LLM-CAD research alignment — Seek-CAD, GenCAD, CADBench & the 2026 field

Research date 2026-07-24. Method: four parallel deep-dives (Seek-CAD + GenCAD paper
reads; gencad.github.io + cadbench.ai source-level reads; broader landscape sweep;
full harness architecture re-verification against the working tree). This doc is the
durable record. It extends [09-cad-skills-research.md](./09-cad-skills-research.md)
(the CAD Skills competitive study) with the *academic* frontier, and answers two
standing questions:

1. **The timeline thesis** — can we surface model-generated CAD as a Fusion-style
   timeline of editable primitive actions (fillet/chamfer/loft/boolean chips with
   tweakable parameters), instead of "just parametric source code"?
2. **The cost question** — is our multi-iteration frontier-model harness the right
   shape, or is there a cheaper/more performant architecture in the literature?

**TL;DR** — The field has converged on our architecture: kernel-backed CAD-as-code
from a strong general model inside an agentic execute-inspect-repair loop now beats
every bespoke CAD model on the benchmarks that gate on *editability*. Our bet is
validated; nothing here says "rearchitect." The timeline thesis is also validated —
but the research answer is to build the timeline as a **view over the code we already
generate** (statement ↔ feature-chip mapping, which our sidecar feature
instrumentation is already 80% of), *not* to make the model emit a bespoke op-DSL.
On cost, the sharpest finding is embarrassing in a good way: production **never
defaults to Opus** (Opus is only the offline eval-judge default), and the single
largest lever is that we send a ~5–8k-token invariant prompt prefix on every attempt
and every agentic turn with **prompt caching entirely unused** — the top CADBench
entry runs 95% cache-read. Caching + prompt modularization + role routing should cut
per-generation model cost by well over half before we touch anything architectural.

---

## 1. Source deep-dives

### 1.1 Seek-CAD (arXiv 2505.17702) — the closest published analogue to the timeline thesis

Xiangdong Zhou's group (Fudan; same lab as CAD-Llama). Training-free text-to-CAD:
a **locally deployed DeepSeek-R1-32B (Q4, single RTX 3090)** generates parametric CAD
code, a VLM (Gemini-2.0) critiques it, and the loop repairs. Three ideas matter to us:

- **The SSR representation.** Every design is a chain of triplets
  `S = (sketch, feature (extrude/revolve/…), ordered refinements ⟨fillet, chamfer,
  shell…⟩)` joined by boolean ops. This is a *feature timeline as a data model* —
  refinements are first-class, ordered, editable actions, exactly the
  fillet/chamfer/loft/boolean chips of the timeline thesis. Their **CapType mechanism
  (START/END/SWEPT)** gives refinements *symbolic* face/edge references, so a fillet
  survives upstream edits without re-deriving coordinates — the invariant a
  user-tweakable timeline needs, and the same problem our doc-01 phase-2 topology
  sidecar attacks from the viewer side.
- **Step-wise visual feedback (SVF).** The critic sees a render *per construction
  step*, not just the final part, plus the generator's own chain-of-thought for that
  step — so feedback localizes to "step 4 is wrong" instead of "regenerate
  everything." Their ablations: removing per-step images degrades feedback; removing
  CoT-to-critic degrades it further; removing **RAG-retrieved exemplars collapses
  Pass@1 from 0.68 → 0.44** — the single biggest ablation in the paper, and direct
  validation of our exemplar machinery (doc 07 / MTR-180).
- **Generator size is not the bottleneck.** A quantized local 32B in the generator
  seat beats GPT-4-class training-free baselines (3D-PreMise, CADCodeVerify) on
  geometric fidelity — though the fine-tuned CAD-Llama still wins on validity rate
  (77.6% vs 64.0%). Iteration quality and in-context exemplars matter more than raw
  generator scale; frontier capability is best spent on the *critic and planner*.

Caveats: bespoke SSR output needs a translation layer to any real ecosystem; validity
still trails fine-tuned models; evaluated on its own benchmark (numbers not
cross-comparable). arXiv was proxy-blocked this session — reconstructed from verbatim
abstract mirrors and two independent third-party deep-read notes; the main results
table was recovered without its header row (column semantics inferred).

### 1.2 GenCAD (arXiv 2409.16294, TMLR 2025) — the cautionary tale on representation choice

MIT DeCoDE lab (Alam & Ahmed). **Image**-conditioned (not text) CAD generation:
transformer autoencoder over DeepCAD command sequences + CLIP-style contrastive
CAD↔image embedding + a latent **diffusion prior** (DALL·E-2 pattern), decoded
through OpenCASCADE to B-rep. Strong numbers on its own turf (99.5% command
accuracy, ~15× better image-based CAD retrieval, beats DeepCAD/SkexGen on
coverage/fidelity), but for us it is mostly a boundary marker:

- **Sketch-and-extrude only.** No fillet, chamfer, revolve, loft, or pattern — the
  DeepCAD grammar cannot express the actions the timeline thesis is about, and the
  authors admit extending it "requires expanding the dataset and modifying the
  architecture." A representation without refinement ops from day one caps the
  ceiling permanently.
- **"Editable" ≠ a feature timeline.** Output replays as history, but it's a
  quantized flat command list: no named features, no design intent, 8-bit-quantized
  coordinates (bad for print-fit dimensions), single-body only, ~3–10% infeasible
  outputs with no repair path (spawning an entire follow-up paper,
  GenCAD-Self-Repairing).
- **The lab itself pivoted to code.** Their follow-up dataset **GenCAD-Code**
  converts the same data to 163k image↔**CadQuery** pairs to train VLMs that emit
  executable code — the strongest single signal that even the sequence-model camp is
  converging on CAD-as-code.

Useful nugget for the marketplace (out of studio scope): the contrastive
CAD↔image embedding is a working recipe for **query-by-image retrieval over a model
library** — relevant someday to marketplace search, noted here so it isn't lost.

### 1.3 cadbench.ai (gNucleus "Parametric CAD Bench") — our architecture, benchmarked

Naming hazard: this is the **gNucleus agentic leaderboard** (100 natural-language →
FreeCAD PartDesign tasks on the Harbor framework), distinct from MIT's academic
"CADBench" (arXiv 2605.10873, mesh/image→CadQuery reconstruction). Both were read;
the gNucleus one is the product-relevant one, and it is the closest thing to an
external referee for our exact architecture:

- **Editability is the gate.** Score = harmonic mean of geometry-similarity ×
  spec-parameter-consistency, and a trial with no valid parametric `.FCStd` document
  scores **zero regardless of geometry** — "a perfect mesh dump scores zero."
  Deterministic scorer (no LLM, no VLM), hermetically sealed per task. This is the
  field formalizing exactly our thesis (README: trustworthy > plausible) and doc
  09's "STEP-primacy is the bar."
- **The harness is worth more than the model.** Swapping the agent driver at fixed
  model shifts scores ~±10%; a full agentic loop (write → execute → read kernel
  errors → repair) roughly **doubles** the composite vs single-call generation on
  comparable models. The dominant failure mode of weak entries is producing *no
  valid parametric document at all* (15–22% FCStd rate for small models) while
  happily emitting scripts.
- **Leaderboard + cost reality** (verified third-party rows, July 2026): Claude Code
  + Claude Fable 5 leads at **0.7577** mean composite, $46.71 for 100 tasks
  (~$0.47/task) with **17.53M input tokens of which 16.66M — 95% — were
  cache-reads**; the Codex+GPT-5.5 reference row sits at 0.832 (8 trials/task,
  ~$170). Claude Haiku 4.5 under a deliberately minimal agent scores 0.358 at $2.73
  — read as a harness statement, not a model ceiling. Costs are re-derived by the
  maintainers from token counts (declared costs are never trusted) — the same
  discipline as our metering-first `cadJobs.usage` design.
- **Their "clean pass@1" doctrine** allows kernel errors, artifact-existence checks,
  and self-measured geometry inside the repair loop — but never ground truth. That
  is precisely the production setting: we have no ground truth either, which is why
  our deterministic gates (grade → dimensions → networks) are the right loop signals.

### 1.4 Landscape sweep (2023–2026) — where every camp landed

Three representation camps, with a decisive 2025–26 convergence:

| Camp | Exemplars | Verdict for us |
| --- | --- | --- |
| **Command sequences** (DeepCAD tokens) | Text2CAD (NeurIPS 24), FlexCAD (ICLR 25), CAD-Editor (ICML 25), CAD-GPT, CADmium | Editability demos, but boxed into sketch+extrude; can't express fillet/chamfer/loft. Their *interaction patterns* (FlexCAD's hierarchy-masked infill, CAD-Editor's locate-then-infill) are worth stealing for timeline edits. |
| **CAD-as-code** (CadQuery/build123d/KCL/FreeCAD Python) | CAD-Recode (ICCV 25), CADCodeVerify (ICLR 25), Query2CAD, cadrille (ICLR 26), Text-to-CadQuery, CAD-Llama, all four 2026 benchmarks | The winning camp — full op vocabulary, kernel-verified validity, statements *are* timeline steps. Text2CAD-Bench: all models score materially worse on command sequences than on CadQuery. **This is our camp.** |
| **Direct neural B-rep / mesh** | GenCAD, BrepGen, Project Bernini, Meshy-class | Not parametric or shallowly so; different market (trinkets) or research-stage. |

Findings that sharpen our roadmap:

- **Small fine-tuned models now beat frontier prompting on closed-domain CAD
  generation.** CAD-Recode: Qwen2-**1.5B** + 1M synthetic CadQuery programs → ~10×
  Chamfer improvement over prior SOTA. Text-to-CadQuery: even a 124M model beats the
  Text2CAD transformer; a fine-tuned GPT-4.1-mini only *matches* a 7B. CAD-Coder
  (VLM): beats GPT-4.5/o1/Gemini-2.0-Pro with 100% valid-syntax rate. This
  *sharpens* (doesn't reverse) doc 09 §5's "don't copy fine-tuned models": for
  **narrow reconstruction/generation tasks** small models win; for open-ended
  dialogue, revision, and taste they don't. The emerging split (Zoo's Zookeeper,
  CADDesigner) is *frontier model as planner/critic, cheap model or deterministic
  tools as the geometry workhorse*.
- **Feedback is migrating from inference-time to train-time.** CADFusion (ICML 25):
  render-and-judge is used as **DPO training signal**, so inference is single-pass —
  the N-iteration harness amortized into weights. cadrille: RL with **programmatic
  geometry rewards** (execute + compare; no VLM at all) cuts invalidity 2–7×.
  Query2CAD: +23 points from its refinement loop — i.e., a third of its quality is
  the loop, at multi-call frontier cost. Direction of travel: keep the loop, make
  each turn cheaper, and treat "bake the loop into a tuned model" as the eventual
  endgame *once volume justifies it* — our rated-generation + outcomes data
  (implicit-signals, MTR-180 flywheel) is the prerequisite asset and is already
  accumulating.
- **Industry**: Zoo (KCL + Zookeeper agent) has the best shipping code↔GUI↔prompt
  round-trip and is the architecture the timeline thesis describes; Adam (YC W25) is
  building the same as a copilot inside Onshape/Fusion; Backflip ($30M) does
  mesh→feature-tree reconstruction; Autodesk has **no shipped prompt→timeline**
  (Bernini is neural geometry; AutoConstrain is assistive) — the incumbent is
  publicly behind on exactly our thesis. PTC/Onshape roadmap mentions generating
  FeatureScript; nothing shipped. The differentiation window doc 09 identified is
  still open, and still contested only by Zoo and Adam.

Access note (trust calibration, per doc 09 convention): the session proxy blocked
arxiv.org, gencad.github.io, cadbench.ai, zoo.dev, and huggingface.co directly.
Everything above was reconstructed from raw GitHub sources (the GenCAD project page
repo and the full cadbench submission/validator repos were read verbatim — leaderboard
numbers are from merged manifest YAMLs, not marketing copy), abstract mirrors, and
search extraction. Paper-internal numbers not verifiable at the primary source are
directionally reliable; spot-check before quoting externally.

---

## 2. What this says about our architecture (critical pass)

**Validated, keep:**

- **CAD-as-code on a B-rep kernel (build123d) with STEP output** — the winning camp
  by benchmark evidence, and the only representation whose statements map 1:1 onto
  timeline actions. The CadQuery A/B lever (`SYSTEM_PROMPT_CADQUERY`) is worth an
  eval pass purely because the research corpus is CadQuery-heavy, but build123d
  shares the kernel and the idiom gap is small.
- **Agentic execute-inspect-repair (doc 03, shipped)** — cadbench quantifies it:
  ~2× composite over single-call. Seek-CAD/Query2CAD/CADCodeVerify all confirm the
  loop is where a third or more of quality comes from.
- **Deterministic gates before the paid judge** (grade → enclosure split →
  dimensions → networks → *then* VLM) — cadrille's programmatic-reward result says
  kernel-derived signals are the cheapest and most reliable critics; we already
  ordered the pipeline this way ("function before beauty", `harness.ts:676`).
- **Exemplar RAG** — Seek-CAD's 0.68→0.44 ablation is the strongest external
  evidence yet for the exemplar flywheel (doc 07). Retrieval quality is worth more
  investment than judge sophistication.
- **Metering-first cost accounting** — cadbench's re-derived-cost discipline is our
  `cadJobs.usage` design; we're ahead of most of the field here.

**Challenged, adjust:**

- **Whole-script regeneration on repair (scripted path).** Seek-CAD's step-localized
  feedback and FlexCAD/CAD-Editor's infill patterns all say: repair the offending
  *step*, keep the rest. The agentic path already does this (sessions, snapshot/
  rollback); the scripted path never will — which is fine *only if* complexity
  routing sends anything non-trivial to the agentic path. The 4-attempt scripted
  loop should be understood as the budget tier, not the workhorse.
- **The monolithic 12.4 KB `SYSTEM_PROMPT`.** Mesh mode, SDF/TPMS vocabulary, and
  dual-fluid exchanger instructions ride on every request including "a 20mm cube",
  while `buildKnowledgeBlock` is already selective on principle
  (`knowledge/index.ts:19-21`). The prompt should be modularized the same way.
- **Critic sees only the outcome, not the intent.** Seek-CAD's CoT-to-critic
  ablation says passing the generator's plan/reasoning to the judge measurably
  improves feedback, at near-zero marginal cost (we already paid for those tokens).
  Our judge gets renders + prompt but not the plan or the brief.
- **Doc 09 §5 on fine-tuned models needs a footnote.** The 2025→26 evidence
  (CAD-Recode, Text-to-CadQuery, CADFusion, cadrille) upgraded "small models can't"
  to "small models win *narrow* seats." No build-now action — but BYOK/model-routing
  (MTR-181) should keep the generator seat swappable, and the data flywheel is the
  asset that makes a future fine-tune possible at all.

**Refuted, drop:**

- Any residual pull toward bespoke op-DSLs or command-sequence generation as the
  model target. GenCAD's own lab converting its dataset to CadQuery closes that
  argument.

---

## 3. The timeline thesis: primitives as editable actions

The thesis (Fusion-style timeline of fillet/chamfer/loft/boolean chips, each with
tweakable parameters, regenerable and exportable) is **the field's consensus
destination** — Zoo ships it, Adam is building it, cadbench scores it, Seek-CAD's SSR
is its data model. The critical design question is *where the timeline lives*, and
the research answer is unambiguous:

> **Generate code whose statements are the timeline steps; render the timeline as a
> bidirectional view over that code.** Do not make the model emit a bespoke op-list
> as the primary artifact.

Reasons: (a) code targets keep the full op vocabulary and kernel validity levers
(Text2CAD-Bench: sequences score worse *per token*); (b) a bespoke DSL forfeits the
pretrained-code prior that makes frontier models good at this at all; (c) Zoo's
KCL↔GUI round-trip proves the view pattern at production quality; (d) the
sequence-camp's own labs are migrating to code.

**We are much closer than the thesis assumes.** Inventory of existing substrate:

| Timeline ingredient | Exists today | Gap |
| --- | --- | --- |
| Ordered op record with params + face IDs | `CadFeature` sidecar instrumentation (`cad-runner/features.py`, `lib/cad/features.ts`) | Per-generation snapshot; not rendered as an ordered timeline UI |
| Clickable chips w/ editable numeric params | `components/cad/feature-chips.tsx` (highlight faces, popover inputs, Reset/Update) | Unordered chip row; params only bound when a *uniquely-matching* top-level constant exists |
| LLM-free regeneration from edited params | `rerunCadWithParams` (`app/actions/cad-generation.ts:866`, route `param-rerun`) | Whole-script re-run (fine — sidecar-only, no model cost) |
| Param extraction/substitution | `components/cad/param-diff.ts` (top-level `name = number` contract) | Blind to params inside function bodies or expressions; mesh/SDF scripts have none |
| Face/edge identity for anchoring | topo sidecar (doc 01 phase 2, `BREP_OUTPUT_FORMATS` includes `topo`) | Not yet joined to features for stable cross-regeneration anchors |
| Exportable editable artifact | STEP on every B-rep success (`fileAssets.stepStorageKey`) | See honesty note below |

The delta to the thesis is therefore **a UI + binding workstream, not a
representation change**:

1. **Order the chips into a timeline** keyed by the op sequence the sidecar already
   records. Cheap, immediate, ships the mental model.
2. **Bind features to source *statements*, not just numeric constants.** The sidecar
   can record the source line/span active when each op executed (build123d ops run
   under our instrumentation already); a chip then owns a code span. This unlocks:
   param edits inside expressions, and **statement-scoped LLM repair** — "regenerate
   only step 4" à la FlexCAD/CAD-Editor infill, with the rest of the script pinned.
   This is the single highest-leverage engineering item in this doc.
3. **Adopt SSR-style symbolic references in the prompt contract**: nudge generated
   code to attach fillets/chamfers via named selectors bound to the features that
   created them (Seek-CAD's CapType insight, build123d idiom: select edges from a
   named intermediate, not from global geometry queries) — so downstream steps
   survive upstream edits. Belongs in `SYSTEM_PROMPT`/repair playbook, costs ~0.
4. **Cross-generation anchors**: join `CadFeature.faceIds` with the doc-01 topology
   sidecar so a timeline step keeps its identity across param re-runs (doc 01
   explicitly punted persistent anchoring; features + topo together are the fix).
5. **Honesty rail for "bring into other programs":** exported STEP carries resolved
   geometry, **not** the feature tree — the same caveat CAD Skills bakes in (doc 09
   §2). The *editable* artifact is the script + timeline inside our studio (or a
   future FCStd/FeatureScript export). Never market STEP export as "edit the
   timeline in Fusion"; do market it as "clean B-rep that any CAD opens", which is
   already above the mesh-gen bar. AP242-style history export is a research
   non-goal across the entire field — nobody does it; we shouldn't try.

What we deliberately do NOT build: a JSON op-list as the model's output format
(GenCAD's dead end, at higher token cost per Text2CAD-Bench); reordering/inserting
arbitrary timeline steps in v1 (Fusion-grade reflow is a kernel-hard problem — Zoo
ships *edit-in-place*, not reorder, and so should we); a bespoke visual programming
language.

---

## 4. The cost question

**First, the diagnosis.** Production model defaults are Sonnet-class everywhere
(`model-client.ts:38`, `agentic.ts:89`); the **only Opus default in the tree is the
offline eval judge** (`scripts/evals/run.ts:56`, `drift.ts:37`). Observed Opus spend
therefore comes from env config (`CAD_MODEL_DEFAULT` / `CAD_MODEL_*` overrides) or
from eval/drift runs — auditable in one `printenv | grep CAD_MODEL` plus a
`scripts/cad-cost-report.ts` pass, which buckets real spend by role×model and route.
Action zero is that audit; everything below assumes it.

Levers, ordered by (savings × ease), with external evidence:

1. **Prompt caching — the headline.** We re-send a ~5–8k-token invariant prefix
   (system prompt + knowledge + exemplars) on every scripted attempt and every one
   of ≤16 agentic turns, and `cache_control` appears nowhere in `model-client.ts` or
   `agentic.ts` — while metering already plumbs `cacheReadTokens`/`cacheWriteTokens`
   waiting to be nonzero. The cadbench leader ran **95% cache-read** input. Cached
   input is ~10× cheaper than fresh input; on the agentic path (system prefix ×
   turns + growing history) this is a step-change, not a trim. One flag per call
   site + an eval-run before/after via the usage summary.
2. **Modularize `SYSTEM_PROMPT` behind the router.** The classifier already labels
   requests; let it gate the mesh-mode, SDF/TPMS, and exchanger sections
   (~3–5k tokens of the 12.4 KB) the way knowledge blocks are already gated. Halves
   the *uncached* prefix for the modal simple part, and (per
   `knowledge/index.ts:19-21`'s own rationale) should *raise* quality on simple
   parts by not diluting attention.
3. **Route roles down-tier, verified by the calibration harness we already built.**
   Plan/brief/title/classify are structurally cheap-model roles (title already
   hardcodes Haiku). The judge is the interesting one: doc 07 left "cheapest
   calibrated judge" open, and `scripts/evals/calibration.ts` + drift gates exist
   precisely to answer it empirically — run judge-model A/Bs through calibration
   instead of guessing. Seek-CAD's asymmetric-seats result (local 32B generator,
   frontier critic) says the *generator* seat is also more downgradeable than
   intuition suggests — with the cadbench Haiku caveat that harness quality bounds
   how far down you can go.
4. **Spend iterations smarter, not fewer.** Keep deterministic-gates-first
   (shipped). Add generator-CoT/plan to the judge context (Seek-CAD ablation,
   ~free). Prefer the agentic path's step-localized repair over scripted
   full-regeneration for anything complex (shipped via routing). Multi-view render
   packets (doc 07) over more rounds — CADCodeVerify's structured-VQA critique
   pattern is the upgrade path for `CRITIQUE_RUBRIC` if judge quality plateaus.
5. **Structural options, priced but not urgent:** best-of-N stays default-off
   (linear cost for variance we don't yet need); fine-tuned generator seat is the
   documented endgame once the flywheel has volume (see §2); BYOK (MTR-181, gated
   on sandbox hardening MTR-187) shifts rather than shrinks cost and prices metered
   tokens at 0 per the existing `cad-pricing.ts` note.

What we do NOT do on cost grounds: abandon the loop for single-shot (every
single-shot system pays for it in validity — GenCAD ~10% infeasible, fine-tuned
CAD-Llama caps at 77.6%); swap to a bespoke sequence representation to "save
tokens" (it scores worse per token); or trust any per-task cost number we didn't
re-derive from metered tokens (cadbench's rule, already our metering design).

---

## 5. Recommendations (cold-executable list)

Ordered by leverage-per-effort. Each should become an MTR issue; this session's
Linear connection could only reach the legacy `connorwhitestudio` workspace, so
filing into MTR + project assignment (Text-to-CAD Studio) is a follow-up for a
session with workspace access.

| # | Action | Anchors | Effort |
| --- | --- | --- | --- |
| 1 | **Env audit**: `CAD_MODEL_*` values in prod + one `cad-cost-report` pass to attribute the observed Opus spend by role×model×route | `lib/cad/models.ts`, `scripts/cad-cost-report.ts` | hours |
| 2 | **Prompt caching**: `cache_control` on the invariant prefix in both call sites; verify via `cacheReadTokens` going nonzero in `cadJobs.usage` | `model-client.ts:126`, `agentic.ts:121` | small |
| 3 | **Modular system prompt**: router-gated mesh/SDF/exchanger sections | `prompt.ts:9-58`, `orchestrate.ts:38` | small-medium |
| 4 | **CoT-to-critic**: include plan/brief + generator reasoning summary in the judge call | `critique.ts`, `harness.ts:719` | small |
| 5 | **Timeline v1**: order feature chips by op sequence; timeline strip UI | `feature-chips.tsx`, `lib/cad/features.ts` | medium |
| 6 | **Statement-span feature binding**: sidecar records source spans per op; chips own code spans; unlocks statement-scoped repair (edit step 4, pin the rest) | `cad-runner/features.py`, `features.ts:79`, FlexCAD/CAD-Editor pattern | medium-large |
| 7 | **Symbolic-selector prompt contract**: SSR/CapType-style "attach refinements to named features, not global queries" rule in SYSTEM_PROMPT + repair playbook | `prompt.ts`, `knowledge/repair-playbook.ts` | small |
| 8 | **Judge down-tier A/B through the calibration harness** (answers doc 07's open question with data) | `scripts/evals/calibration.ts`, `drift.ts` | small-medium |
| 9 | **Eval scoring upgrade**: adopt cadbench's harmonic geometry×spec composite with a validity gate in `scripts/evals/run.ts`; consider a private run of our harness against the 100-task suite as an external yardstick | `scripts/evals/`, gNucleus validator | medium |
| 10 | **Watch-items** (no action): CADFusion-style train-time DPO once flywheel volume justifies; Zoo API as build-vs-buy fallback; Backflip-style mesh→parametric for uploaded STLs; cross-generation timeline anchors after doc 01 phase 2 lands | — | — |

Items 1–4 are the cost package (target: >50% model-cost reduction on the modal
generation with zero quality risk, most of it from #2). Items 5–7 are the timeline
thesis shipped as increments on the existing substrate. Items 8–9 keep the
verification story honest as costs drop.

## 6. Sources

- Seek-CAD: arXiv 2505.17702 (Li, Li, Song, Lou, Zhou) — via abstract mirrors +
  third-party deep-reads (primary blocked; see access note §1.4)
- GenCAD: arXiv 2409.16294, TMLR 2025 (Alam, Ahmed, MIT) — project-page source repo
  `gencad/gencad.github.io` + `ferdous-alam/GenCAD` read verbatim; follow-ups
  GenCAD-Code (`anniedoris/GenCAD-Code`), GenCAD-3D (2509.15246),
  GenCAD-Self-Repairing (2505.23287)
- cadbench.ai: `gNucleus-AI/cad-bench-submission` (all merged leaderboard manifests
  read verbatim), `gNucleus-AI/freecad-validator`, Harbor task suite
  `gnucleus-ai/cad-bench@v1`; hodgesj Substack review (June 2026)
- Benchmarks: Text2CAD-Bench (2605.18430), MIT CADBench (2605.10873), BenchCAD
  (2605.10865), CADPrompt (`Kamel773/CAD_Code_Generation`), MUSE (2605.28579)
- Editable representations: Text2CAD (2409.17106), FlexCAD (2411.05823, ICLR 25),
  CAD-Editor (2502.03997, ICML 25), CAD-GPT (2412.19663), CADmium (2507.09792),
  HistCAD (2602.19171), DeepCAD, SkexGen, HNC-CAD, CAD-SIGNet, OpenECAD,
  CAD-MLLM (2411.04954), Fusion 360 Gallery (`AutodeskAILab/Fusion360GalleryDataset`)
- Code-CAD + feedback loops: CAD-Recode (2412.14042, ICCV 25), CADCodeVerify
  (2410.05340, ICLR 25), Query2CAD (2406.00144), cadrille (2505.22914, ICLR 26),
  CADFusion (2501.19054, ICML 25; `microsoft/CADFusion`), Text-to-CadQuery
  (2505.06507), CAD-Coder (2505.14646), CAD-Llama (2505.04481), BlenderLLM
  (2412.14203), LLM4CAD (ASME JCISE 2025), survey 2505.08137
- Industry: zoo.dev (KCL, Text-to-CAD, Zookeeper), adam.new + TechCrunch
  (2025-10-31), backflip.ai, Autodesk (Bernini, neural-CAD announcement,
  AutoConstrain, AI Lab), PTC/Onshape AI Advisor, spline.design
