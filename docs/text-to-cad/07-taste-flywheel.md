# 07 — Taste flywheel: judge on, better eyes, exemplars that grow

## Current state

The taste stack is unusually complete for its age — but half of it is switched off or
starved of signal:

- **VLM judge** (`lib/cad/critique.ts`, rubric in `critique-core.ts`: 5 anchored
  dimensions, weighted aggregate, `PASS_THRESHOLD = 75`) is **gated off by default**;
  when off, `judgeAesthetics` returns `available: false` and the visually-weak repair
  turn (`harness.ts:334-354`) never fires.
- **The judge and repair loop see one image**: a single 3/4-view matplotlib Lambert
  render (`cad-runner/app.py:_render`, elev 22 / azim −55). One view hides sink faces,
  back-side lumps, and proportion problems; clay-matplotlib flatters nothing and reveals
  little.
- **Exemplar selection is brittle keyword matching** (`selectExemplars`,
  `lib/cad/knowledge/exemplars.ts:487-509`): "drone leg mount" scores 1 only via "mount";
  "GoPro chest harness clip" via "clip". Misses = the model gets no style reference.
- **The flywheel data already exists but goes nowhere**: `rating`, `feedbackTags`,
  `feedbackNote` (per-generation), `aestheticScore`, and **print-through** (generation →
  print order join, `app/(app)/prometheus/eval/page.tsx:84-100`) are collected; only the
  scorecard reads them. MTR-170 is the open spike for auto-promoting exemplars.

## Spec

### A. Multi-view renders (prerequisite for everything else)

- `_render` accepts view params; `/run` returns `renders: { threeQuarter, top, front,
  side }` (keep `renderPng` = threeQuarter for compatibility). Budget: 4 small PNGs
  ≈ trivial vs the 60s cap.
- Judge receives all views in one call (multimodal content blocks — the client already
  supports image arrays). Repair turns attach the view that scored worst if the judge
  named one, else threeQuarter + top.
- Optional stretch: swap matplotlib for `pyrender` + EGL (already headless-safe in the
  Docker image? verify) for honest shading; the studio-side three.js look is *not* the
  target — the judge needs geometric truth, not beauty.

### B. Judge on by default

- Flip the gate (env `CAD_CRITIQUE=false` to disable, inverting today's default) once A
  lands. Cost: one haiku/sonnet-class call per successful generation (`critique` role in
  `lib/cad/models.ts` routes it independently — point it at a cheap model).
- Persist per-dimension scores, not just the aggregate: `cadGenerations.aestheticDims`
  (jsonb) — the scorecard can then show *which* dimension (cohesion vs surfacing) drags,
  which is what actually directs prompt/exemplar work.
- Calibration harness: `scripts/evals/run.ts` already shares the rubric via
  `critique-core.ts`; add a small fixed set of renders with hand-assigned scores and
  fail evals if the judge drifts > n points (model-upgrade insurance).

### C. Exemplar retrieval v2

- Replace keyword scoring with embeddings: embed `title + lesson + keywords` per
  exemplar offline (checked-in vectors — the pool is tiny), embed the prompt at request
  time, cosine top-1 with a floor. Fallback to keyword scoring when no embedding
  credentials. (Alternative accepted at implementation time: let the plan/brief step
  *choose* the exemplar id from a catalog — zero new infra, one more prompt line.)
- Raise `limit` to 2 when the top two scores are close — e.g. "enclosure" + "gyroid"
  both matter for a vented case.

### D. Close the flywheel (MTR-170, concretized)

- Nightly job (or on-feedback trigger): generations with `rating='good'` AND
  (`aestheticScore >= 80` OR print-through) AND `engine='build123d'` (parametric source
  only) become **exemplar candidates**: run the source through
  `scripts/verify-exemplars.ts` logic (compile + watertight in the sidecar), auto-draft
  an entry (title from thread, lesson written by a model call, keywords from the prompt)
  into a review queue — a JSON file PR or an owner-visible admin list. **A human
  approves; nothing auto-injects** (the `verified: true` contract stays manual by
  policy, not just mechanism).
- Cap the live pool (~30) and track per-exemplar hit-rate + downstream rating so weak
  exemplars rotate out — the pool should evolve toward what measurably helps.

## Acceptance

- Judge-on: a deliberately lumpy multi-boolean part triggers a visually-weak repair turn
  and the repair measurably improves its score (existing eval telemetry shows both).
- "drone leg mount" retrieves `organic_sdf_bracket` or `fillet_hierarchy_bracket` (not
  nothing) under retrieval v2.
- Scorecard shows per-dimension aesthetic breakdowns and a remesh-rate column (doc 02).
- One full flywheel cycle demonstrated: rate a strong generation 👍 → candidate appears
  in queue → approve → next matching prompt injects it (verify via telemetry/log).

## Open questions

1. Embedding provider/model for C (Anthropic has none; Voyage or local MiniLM via a tiny
   worker — or take the model-chooses-from-catalog alternative and skip embeddings
   entirely). Decide at implementation.
2. Judge model routing default (`CAD_MODEL_CRITIQUE`) — cheapest model that stays
   calibrated on the fixture set wins.

## Dependencies

- A precedes B (judge needs the eyes) and helps doc 03 (`render(views)` tool shares the
  sidecar work). D extends MTR-170 (link, don't duplicate). C is standalone.
