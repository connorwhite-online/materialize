# CAD Skills (earthtojake/text-to-cad) — competitive deep-dive & gap analysis

Tracked as **MTR-195**. Research date 2026-07-05; analyzed at their commit `622c258`
(v0.3.8, 2026-06-29). Method: full-repo read (three parallel deep-dives: core modeling
skills; fabrication chain + benchmarks + repo architecture; external landscape with cited
sources). This doc is the durable record; the same content lives as a Linear document on
the Text-to-CAD Studio project.

**TL;DR** — CAD Skills is the strongest open-source expression of the *same architecture
we bet on* (LLM writes parametric Python → execute → deterministic inspection → visual
self-review → iterate). It validates our direction almost point-for-point, and it is
*complementary, not competitive*: it deliberately ends at "STEP/STL on local disk, print
on your own Bambu." Our moats — hosted zero-setup UX, the marketplace, and industrial
fulfillment — are exactly the pieces it doesn't build. The gaps it exposes in our harness
are concrete and adoptable: STEP-first artifacts with stable topology addressing, a
dimension-verification contract, their kernel-failure repair playbook, snapshot review
doctrine, off-the-shelf part sourcing, and rubric-style eval specs. Each is filed as a
cold-executable issue (table below).

## 1. What it is

A **skills library** (MIT, `npx skills install earthtojake/text-to-cad`, plus Claude Code
and Codex plugin marketplaces) that turns any general coding agent into a CAD/robotics/
fabrication workstation. No hosted generation service, no accounts, no pricing — the
tagline is "100% open source, runs locally, and free forever." 11 skills:

| Skill | Role |
| --- | --- |
| `cad` | The core: STEP-first parametric parts/assemblies from build123d Python |
| `cad-viewer` | Local browser viewer (three.js) for STEP/mesh/DXF/G-code/URDF/SRDF/SDF |
| `step-parts` | Off-the-shelf STEP part sourcing from the hosted api.step.parts catalog |
| `dxf` | 2D drawings; projects contours from real STEP topology |
| `gcode` | FDM slicing via real slicer CLIs (Orca/Prusa/Cura) + static G-code validation |
| `bambu-labs` | Direct LAN print on Bambu printers (FTPS + MQTT), layered safety gates |
| `sendcutsend` | DFM preflight vs SendCutSend's live catalog before job-shop upload |
| `urdf`/`srdf`/`sdf` | Robot description, MoveIt2 planning config, simulator worlds |
| `implicit-cad` | Experimental: GLSL SDF models raymarched in-browser, marching-tetrahedra export |

**Traction / trajectory**: ~7.6k GitHub stars and 20 tagged releases in ~6 weeks
(first commit 2026-05-20); front-paged HN in May 2026. Effectively a solo project by Jake
Fitzgerald (ex-WhatsApp, ex-Lyra), now "building robots at South Park Commons" — the
library reads as infrastructure/portfolio for a robotics venture, not a monetization
vehicle. Robotics (URDF/SRDF/SDF + MoveIt2 viewer integration) is the core bet; the
fabrication skills are the supporting cast. Bus factor of one; heavily agent-authored
(`codex/...` branches throughout).

## 2. Their architecture in brief

```
Coding agent (Claude Code / Codex — BYO model)
  └─ skills/cad SKILL.md (~100 lines) + 9 progressive references (load-on-trigger)
       ├─ author build123d Python:  def gen_step(): → shape/labeled Compound
       ├─ python scripts/step      execute (in-process import, AST-validated entry,
       │                           CLI owns output paths; source-hash cache)
       │     → part.step (XCAF: labels/colors survive)
       │     → hidden .part.step.glb topology sidecar (custom STEP_topology glTF
       │       extension: occurrence/face/edge selector tables + per-edge flags
       │       SEAM/BOUNDARY/NON_MANIFOLD/HARD/TANGENT)
       ├─ python scripts/inspect   refs --facts --planes --positioning (mandatory baseline)
       │                           measure / align / frame / diff  — all answered from
       │                           the cached topology manifest, never re-opening OCCT
       ├─ python scripts/snapshot  Playwright headless-Chromium render packets
       │                           (opposed-iso + top + front; section mode; GIF orbits)
       └─ handoff → $cad-viewer (mandatory), $gcode → $bambu-labs, $sendcutsend, $dxf
```

Key mechanics worth knowing cold:

- **STEP is primary, meshes derivative.** "Treat STEP as the primary CAD artifact. Treat
  STL, 3MF, and native GLB as secondary export workflows." STL via OCP `StlAPI_Writer`;
  3MF via a dependency-free hand-rolled colored writer; GLB Y-up/meters.
- **Stable selector refs** (`#o1.2.f1` = occurrence.shape.face ordinals) backed by the
  topology sidecar make every follow-up measurement/alignment/diff cheap and addressable
  across regenerations — the substrate for their whole verification story.
- **Editing = edit source, regenerate, diff.** One Python generator per part, same
  basename as its STEP, "Edit source, not generated artifacts" is a non-negotiable.
  Assemblies via `AssemblyHelper` (semantic sugar over build123d joints: `face_to_face`,
  `coaxial`, `revolute_frame`…) with named mating datums; honest caveat baked in that
  exported STEP holds resolved placements, not live constraints.
- **Verification doctrine** (the best prompt-engineering in the repo):
  - Deterministic first: `refs --facts` baseline for *every* artifact, then targeted
    `measure`/`align` for every user-specified dimension.
  - "**Snapshot validation is mandatory** … deterministic checks passing is not a reason
    to skip." Default packet: iso + *opposite* iso + top + front — "the two opposed
    isometric views guarantee every face appears in at least one image."
  - "Visual review is diagnostic, not authoritative. **Convert every visual concern into
    a follow-up geometry check** before using it as a validation claim."
  - "**Do not loop on snapshots.** Rerender only when a source repair changed visible
    geometry."
  - Honesty rails: "Report only checks that actually ran"; do-not-claim list (structural
    safety, tolerances, manufacturability beyond geometric plausibility).
- **Kernel-failure playbook** (`references/repair-loop.md` + modeling refs): fillets last
  ("the most failure-prone operation; every boolean invalidates selectors"); overshoot
  boolean tools ~1 mm past both faces (coplanar tool/target faces are a classic kernel
  failure); base solid → additions → subtractions → shell → holes → fillets ordering so
  "failures localize"; 8-class failure taxonomy each with causes + fixes; "change the
  smallest responsible source section, regenerate, rerun the failed validation."
- **Defaults + one-question policy**: wall 2.0–3.0 mm, cosmetic fillet 1–3 mm, M3/M4/M5
  clearance 3.4/4.5/5.5 mm; "Ask one focused clarification question only when missing
  information makes the model impossible, fit-critical, safety-critical, or
  compliance-bound. Otherwise proceed with explicit assumptions."
- **Fabrication chain is gate-by-gate** with real tools and explicit humility: wrapper
  profile JSON required ("Do not invent real-printer profiles"), dry-run before every
  live printer action, `--execute --confirm-start-print` for starts, physical-presence
  checklist, "watch the printer until the first layer is clearly normal."
- **step.parts** is a real hosted free API (`api.step.parts/v1/parts`, ~16k parts:
  fasteners by standard, bearings, hobby-robotics servos/boards) with sha256-checksummed
  STEP downloads. Policy: search before modeling placeholder geometry; a network failure
  is not a "no match"; record misses and fall back to documented envelopes.
- **Benchmarks**: 10 markdown specs (calibration block → planetary gear stage), each an
  exact prompt + expected-results table + a *negative check* row ("No chamfers on holes;
  no extra bosses, slots, text, or decorative geometry"). Well-specified rubrics — but
  **no automated runner exists**; they're manual eval specs + showcase GIFs.
- **implicit-cad**: one GLSL SDF source raymarched live on GPU *and* interpreted on CPU
  (hand-written GLSL interpreter) for marching-tetrahedra export. Zero preview/export
  drift is clever; CPU meshing is slow (resolution ceiling ~192) and it's self-demoted:
  "ALWAYS prefer conventional STEP-first CAD workflows." Their TPMS library (gyroid,
  Schwarz, diamond, lidinoid, neovius, split-P, IWP + Rvachev blends) overlaps our
  sdf_kit v2 (MTR-177) — we're ahead here on the composition bridge and network-isolation
  verification; they're ahead on live GPU preview.

## 3. What this validates about our direction

The field has converged on our architecture. CAD Skills, flowful-ai/cad-skill,
cyberchitta/cad-khana, the FreeCAD MCP servers, and the research frontier (TOOLCAD's
RL-over-execute-inspect loop, Zero-to-CAD's agentic corpus synthesis) all landed on:
**parametric code-gen → sandboxed execute → deterministic geometry inspection → rendered
self-review → iterate**, riding frontier-model quality rather than fine-tuned sequence
models. Specific confirmations:

- **Agentic sessions over scripted retries** (MTR-176) — their whole product is "the
  agent iterates with tools"; our stateful sidecar sessions + tool-use loop is the hosted
  equivalent, and our complexity routing + budget discipline goes further than they do.
- **The taste stack is differentiation they don't have.** Nothing in CAD Skills does
  concept images, aesthetic judging, exemplars, FEA critique, or DFM knowledge. Their
  output taste is whatever the model does unprompted. Our thesis (harness + verification
  + taste as the moat) survives contact: their 7.6k stars prove "an LLM writes CAD code"
  is commodity; taste and trust are not.
- **SDF/TPMS work (MTR-177) is on trend** — they ship a TPMS library too, but demote it
  to experimental; our B-rep↔SDF composition bridge and dual-network verifier are beyond
  their scope.
- **Ask-first + explicit assumptions (MTR-194/191)** — their one-question policy and
  defaults table is nearly identical to what we shipped.
- **Sidecar isolation (MTR-157/187)** — they execute model code **with no sandbox at
  all** (local trust model). Our container boundary + planned hardening is ahead, and it
  matters more for us (hosted, multi-user someday).
- **Bambu/MakerWorld precedent** (PrintMon Maker, Meshy-in-MakerLab) shows marketplaces
  bolting on *mesh trinket* generation. Nobody has shipped parametric/functional
  generation attached to marketplace + industrial fulfillment. That whitespace is ours.

## 4. Gaps adopted (filed as issues)

| Gap | What they do that we don't | Filed |
| --- | --- | --- |
| STEP-first artifact chain | STEP via XCAF + cached topology sidecar with stable `#o1.2.f1` refs + edge classification (incl. `TANGENT` — our unselectable-fillet-boundary bug); colored 3MF export | MTR-196 (substrate for MTR-174; feeds MTR-40/44/188) |
| Dimension contract | "Convert every dimension callout into a named parameter and a validation target"; targeted measure/align checks per spec; ~100-line validators (`assert_bbox_span`, `assert_close`) | MTR-197 |
| Repair playbook | 8-class kernel-failure taxonomy with causes/fixes (fillets last, overshoot booleans, Mode.ADD/SUBTRACT, selector fragility) as knowledge + error enricher | MTR-198 (seeds MTR-186) |
| Snapshot doctrine | Opposed-iso coverage guarantee, section mode for cavities, visual-concern→deterministic-check conversion, no-snapshot-loops, honesty rails | MTR-199 (extends MTR-180) |
| Off-the-shelf part sourcing | search step.parts before placeholder geometry; checksummed STEP downloads mated via inspected frames | MTR-200 |
| Eval rubrics | Prompt + expected-results table + negative checks per case; their 10 MIT-licensed cases as a seed set — and we can automate what they never did | MTR-201 |
| Fulfillment rails for agent-native CAD (strategic) | Their users end at "STL on disk, print on your Bambu or SendCutSend" — our MCP `place_print_order` is the natural next hop | MTR-202 (Needs Decision, Agent Orders & MCP) |

Also folded into existing issues rather than new ones:

- **MTR-187 (sandbox hardening)** — commented with their `gen_step()` contract details
  worth adopting at the sidecar boundary: AST-validate the entry point before exec
  (zero-arg, no decorators), harness owns all output paths, source-hash caching.

## 5. What we deliberately do NOT copy

- **Local-first BYO-agent distribution as the product.** Their model has near-zero
  capture by design; ours is hosted UX + marketplace + fulfillment. We meet their users
  at the MCP/skill boundary (MTR-202), we don't chase them to the terminal.
- **Robotics (URDF/SRDF/SDF/MoveIt2).** Core to their thesis, off-mission for ours.
  Revisit only if agent-ordered robot parts become a real MCP demand signal.
- **Direct printer control (Bambu LAN).** CraftCloud is our fulfillment layer; owning
  reverse-engineered printer protocols is their problem. Their *safety-gate discipline*
  (dry-run defaults, explicit confirm flags, calibrated consent) is still worth citing
  in agent-order UX reviews (cf. MTR-152 lineage).
- **In-browser GLSL raymarch modeling.** Our sdf_kit is Python/numpy in the sidecar and
  composes with B-rep; their implicitjs is a demo-grade preview tech with a slow
  interpreted export path. GPU preview of SDF params could matter someday for the
  template gallery (MTR-190) — note it there, don't build it now.
- **Small fine-tuned CAD models.** Landscape confirms general frontier models + agent
  scaffolds are outrunning specialized fine-tunes (the premise of both their product and
  ours). BYOK/model routing (MTR-181) stays the right frame.

## 6. Strategic reads

1. **Generation is being commoditized to free** — 7.6k stars in 6 weeks for a free local
   tool says the maker/hacker segment self-serves. Durable value: zero-setup hosted UX,
   taste/trust stack, marketplace distribution, industrial fulfillment (SLS/MJF/metals
   vs their FDM-and-sheet-metal ceiling), and the quote→checkout→order machinery.
2. **Complement, don't compete** — a Materialize skill/MCP entry ("manufacture this
   STEP/STL: instant quotes in 100+ materials, ships to you") is the missing terminal
   node of their pipeline. Their repo already ships a SendCutSend handoff skill, proving
   third-party fabrication handoffs are welcome in that ecosystem (MTR-202).
3. **Assume agents arrive with geometry.** Anthropic ships first-party CAD connectors
   (Fusion, SketchUp, Blender — Apr 2026); Codex ships skills; every frontier assistant
   will have some CAD ability by default. Our studio should gracefully accept/repair
   *uploaded* STEP and agent-authored scripts, and the MCP surface is the front door
   coding-agent vendors are teaching users to walk through.
4. **STEP-primacy is the emerging bar** for anything calling itself CAD (vs trinket-mesh
   gen). An STL-only pipeline reads as below-bar to exactly the users most likely to pay
   for functional parts (MTR-196).
5. **Watch Jake's trajectory, low competitive risk** — no monetization anywhere,
   step.parts free, headed toward a robotics venture. Likelier outcome: CAD Skills
   becomes the de-facto open standard for agent CAD skills — i.e., an integration
   target, and a place our fulfillment skill could live.

## 7. Landscape snapshot (2026-07, for calibration)

| Player | Approach | Notes |
| --- | --- | --- |
| CAD Skills | Skills on general agents; build123d code-gen; STEP-first | 7.6k★, free, local; this doc |
| Zoo/KittyCAD | Own kernel + KCL + trained models + Zookeeper agent | ~$10M raised; only full-stack owner |
| AdamCAD (YC W25) | Consumer text-to-3D → copilot inside Onshape | $4.1M seed Oct 2025 |
| Camfer (YC S24) | "AI mechanical engineer" driving SolidWorks/Onshape | $4.8M seed |
| Backflip | Scan/mesh → parametric B-rep ML | $30M (NEA + a16z) |
| Anthropic | Claude for Creative Work: Fusion/SketchUp/Blender MCP connectors | All plans incl. free (Apr 2026) |
| Bambu MakerWorld | PrintMon Maker + Meshy 6 in MakerLab | Mesh trinkets in a print marketplace — closest precedent, not parametric |
| Research | Text2CAD-Bench (2605.18430), TOOLCAD (RL over execute-inspect), Zero-to-CAD, PartCrafter | Frontier formalizing the agent loop, not betting on seq2seq CAD models |

Three architecture camps: (a) skills/code-gen on general agents (free, fast-riding);
(b) copilots inside incumbent CAD (where the funded startups are); (c) owned-stack
verticals (Zoo, Backflip). We are a fourth: **hosted generation fused to marketplace +
manufacturing** — nobody else is in that seat.

## 8. Sources

- Repo: https://github.com/earthtojake/text-to-cad (analyzed at `622c258`, v0.3.8) —
  esp. `skills/cad/SKILL.md` + `references/*`, `skills/*/SKILL.md`,
  `packages/cadpy/`, `benchmarks/*.md`, `.github/workflows/`, AGENTS.md, CONTRIBUTING.md
- Sites: cadskills.xyz, demo.cadskills.xyz, step.parts (partially proxy-blocked;
  triangulated via snippets)
- Author/launch: HN item 47970497; x.com/earthtojake; github.com/earthtojake
- Landscape: zoo.dev/text-to-cad; TechCrunch on Adam (2025-10-31);
  ycombinator.com/companies/camfer; 3dprintingindustry.com on Backflip & Meshy/MakerWorld;
  anthropic.com/news/claude-for-creative-work; github.com/flowful-ai/cad-skill;
  github.com/cyberchitta/cad-khana
- Research: arXiv 2605.18430 (Text2CAD-Bench), 2604.07960 (TOOLCAD), 2604.24479
  (Zero-to-CAD), 2606.11152 (P3D-Bench), 2505.08137 (survey)

Confidence notes: repo-internal claims verified by direct read at the pinned commit.
Traction numbers (stars, funding) from search-result snippets of primary sources —
directionally reliable, spot-check before quoting externally. HN comment thread was
unreachable through the session proxy; "what users say" is triangulated from the
author's posts, repo issues (#94: benchmark reproducibility complaints), and secondary
coverage.
