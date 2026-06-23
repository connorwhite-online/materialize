# Tier 2 — FEA-driven topology optimization (Fusion-grade generative design)

> Paste into Linear (CON project). Tier 1 (SDF "functional skeleton + organic
> skin") shipped on branch `text-to-cad-studio-chat`; this is the gold-standard
> follow-up.

## Why
Tier 1 gives organic, load-path-_looking_ forms by hand-authoring an SDF skin
over exact functional anchors — beauty is _applied_. Autodesk Fusion generative
design produces its results a different way: beauty is _derived from physics_.
You give it functional anchors + loads + constraints, and an FEA-based optimizer
removes material to minimize mass while meeting stress/stiffness targets. The
organic form **is** the optimal load path — which is why it's simultaneously
beautiful, light, and functional. Tier 2 = bring that into the harness.

## Goal
From a prompt, produce a **function-derived** organic part: the model specifies
a topology-optimization *problem* (not geometry), a solver generates the optimal
material layout, and we reconstruct a watertight printable mesh with the exact
functional features preserved.

## Approach
3D SIMP (Solid Isotropic Material with Penalization) topology optimization:
1. **Problem spec** (LLM-generated, not geometry):
   - Design space (bounding box) + voxel resolution.
   - **Keep-in** regions = the exact functional anchors (bosses, bores, bearing
     faces) — reuse the Tier-1 SDF/build123d primitives to mark fixed material.
   - **Keep-out** regions (clearance zones).
   - **Load cases**: forces (vector + magnitude) at points/faces.
   - **Supports**: fixed faces/points (boundary conditions).
   - Material (E, ν), target volume fraction, min feature size.
2. **Solver**: 3D SIMP loop (FEA solve → sensitivity → density update → filter).
   Start from the canonical Sigmund 99-line → `top3d` 3D port; or build on a FEA
   lib (FEniCS / `solidspy` / `sfepy`). GPU/sparse solve for reasonable speed.
3. **Reconstruct**: density grid → smooth + threshold → marching cubes →
   re-stamp the exact keep-in features (crisp bores/faces) → watertight + the
   existing validation/repair pipeline.
4. **Harness integration**: a new LLM step that maps prompt → problem spec
   (loads/constraints/anchors), with a confirm/edit surface for the loads.

## Risks / open questions
- **Compute**: 3D topopt is minutes-scale and memory-heavy → needs an async
  worker / job queue, not the lightweight per-request sidecar (which is 60s).
- **LLM → load cases**: translating "a phone tripod" into correct forces/supports
  is non-trivial and error-prone; may need guided defaults + user confirmation.
- **Manufacturability**: bake in overhang/min-feature/self-support constraints
  (manufacturing-aware topopt) so results print without heavy support.
- **Feature preservation**: cleanly reconstructing crisp functional faces from
  an optimized density field.
- **Solver choice / licensing**: pure-Python vs FEniCS vs commercial.

## Milestones
1. Standalone 3D SIMP on a canonical cantilever (validate the solver).
2. Keep-in / keep-out + multiple load cases.
3. Functional-anchor preservation in reconstruction.
4. Manufacturing constraints (overhang/min feature).
5. LLM prompt → problem spec (+ confirm UI).
6. Harness integration as an async job (status streaming), reusing the mesh
   validate/repair/render pipeline.

## References
- Bendsøe & Sigmund, *Topology Optimization: Theory, Methods and Applications*.
- Sigmund, "A 99 line topology optimization code" (+ 88-line; `top3d` 3D port).
- Function representation / implicit modeling: Pasko & Adzhiev (FRep); Inigo
  Quilez SDF + smooth-min (already used in Tier 1 `cad-runner/sdf_kit.py`).
- nTopology / Fusion generative design (commercial reference points).
