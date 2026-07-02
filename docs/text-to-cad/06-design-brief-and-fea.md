# 06 — The design brief intermediate + FEA-in-the-loop

## Problem

The product's default-taste promise is: *"drape an organic, premium form over a tight
stack of components and keep the enclosure functional"* — great shapes from minimal
input. Two gaps stand between the current harness and that promise:

1. **The harness has no model of what's inside.** The concept image
   (`lib/cad/concept.ts`) supplies form language but flux knows nothing about the actual
   components, clearances, or ports; the plan step emits free prose. "Function first"
   lives only as a system-prompt exhortation (`SYSTEM_PROMPT` rule, `lib/cad/prompt.ts:17`).
2. **"Structural" is aesthetic, not physical.** The SDF load-path look
   (`organic_sdf_bracket` exemplar) is hand-drawn plausibility. The Tier-2 plan
   (`docs/text-to-cad-tier2-topology-optimization.md`) derives form from physics via full
   SIMP topology optimization, but that is minutes-scale, needs the doc-02 worker, and
   its riskiest step is LLM→load-case translation. There is a cheap intermediate that
   captures most of the value.

## Spec — Part 1: the design brief

A structured JSON intermediate between prompt and code. The plan step's output becomes
data, not prose.

```jsonc
{
  "part": "enclosure for a 60x40mm sensor board with USB-C and two M3 mounts",
  "components": [            // things the part must contain/interface with
    { "name": "pcb", "box": [62, 42, 12], "clearance": 1.0,
      "mounts": { "pattern": "corners", "inset": 3.5, "screw": "M2.5" } }
  ],
  "interfaces": [            // where the part meets the world
    { "type": "port", "std": "usb-c", "face": "+X", "center_z": 4.5 },
    { "type": "vent", "area_mm2": 200, "faces": ["-Y", "+Y"] }
  ],
  "keepOut": [],             // explicit exclusion volumes
  "loads": [                 // optional; feeds Part 2 / Tier 2
    { "at": "mount:*", "kind": "static", "n": 20 }
  ],
  "form": { "language": "soft-premium", "constraints": ["desk-stable", "one-hand-liftable"] },
  "envelope": { "max": [90, 70, 30] },
  "process": null            // CadProcess when known (ties into MTR-171)
}
```

- **Producer**: a `brief` role (new `CadRole`) replaces/extends the plan step for fresh
  builds. Zod-validate; on invalid output fall back to today's prose plan — the brief is
  additive, never blocking (mirror the plan step's best-effort contract,
  `harness.ts:236-254`).
- **Consumers**:
  - The generate step receives the brief verbatim (structured section in the user
    prompt): dimensions/clearances stop being lost in prose.
  - The concept image prompt is built *from the brief* (envelope proportions, form
    language) instead of the raw user prompt — the taste target starts matching the
    functional reality.
  - `sdf_kit` anchors (doc 04) and `check_networks` ports map 1:1 from `components`/
    `interfaces`.
  - Doc 01's annotations can reference brief entities ("the USB-C cutout") — stable
    across regenerations in a way face ids are not.
  - The Tier-2 SIMP problem spec is this schema + `loads` matured — writing the brief
    now de-risks that flagship.
- **Persistence**: `cadGenerations.brief` (jsonb, nullable). Revisions inherit and may
  amend it ("actually the PCB is 62mm wide" → brief patch, not prose archaeology).
- **UI (later, flagged)**: show the brief as an editable card between submit and
  generate for complex prompts — catch "wrong PCB size" before spending a generation.
  V1 ships without UI; the brief is still valuable invisible.

## Spec — Part 2: FEA-in-the-loop (the cheap 80% of Tier 2)

Not SIMP. A coarse voxel FEA **critic**: seconds, not minutes; advises, never generates.

- Sidecar: `fea_probe(mesh_or_field, loads, supports, resolution≈32..48)`:
  voxelize → linear elastic solve (`solidspy`, or a small hand-rolled 8-node hexahedral
  assembly + `scipy.sparse.linalg.cg` — spike decides) → per-voxel von Mises → return
  top-k hotspot locations (mm), a compliance number, and a hotspot overlay render.
- Loads/supports come from the brief (`loads`, `mounts` ⇒ supports); when absent, apply
  the conservative default (gravity + 3× self-weight at the working face, fixed at
  mounts) and label the result as assumption-based.
- Consumption: in the doc-03 agent loop as a tool (`fea_probe()` → "thicken here, add a
  capsule strut along this path" — vocabulary the SDF mode already has); in the plain
  loop as one extra repair-turn trigger when compliance/stress exceeds a loose threshold
  for load-bearing parts (`bracket|mount|hook|arm|shelf` keyword class).
- Explicitly a *critic*: geometry always comes from the model. Full SIMP (physics
  *generates* form) remains Tier 2, gated on the doc-02 worker, per the existing doc.

## Acceptance

- "an enclosure for a 60x40 PCB with USB-C" yields a brief whose `components[0].box`
  matches, and the generated cavity is ≥ PCB + clearance on all axes (assert via
  geometry stats — this becomes an eval case with `expectedDims`-style checks on the
  cavity, not just the outer box).
- Revision "the board is actually 65mm long" patches the brief and the regenerated
  cavity tracks it.
- `fea_probe` on the L-bracket eval case returns the root as the top hotspot in <10s at
  res 32; an agentic run demonstrably thickens it.
- Briefless behavior (validation failure) is byte-identical to today's plan step.

## Open questions

1. Brief schema governance: version field from day one (`"v": 1`); expect churn.
2. Component library: `std: "usb-c"` implies a lookup of real cutout dims — start with a
   tiny hand-curated table (USB-C, USB-A, barrel jack, RJ45, M2–M6 patterns) next to
   `lib/cad/knowledge/fasteners.ts`.
3. Solver choice for `fea_probe` (`solidspy` pulls scipy only — likely fine). Spike
   before committing the container image.

## Dependencies

- Standalone for Part 1. Part 2 wants doc 03 (as a tool) but has a degraded plain-loop
  mode. Feeds doc 04 (ports/anchors) and Tier 2 (problem spec). Ties into MTR-171
  (process → brief.process).
