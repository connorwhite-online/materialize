# 04 — sdf_kit v2: TPMS primitives, B-rep bridge, and the dual-network verifier

## Problem: the representations cannot compose

The harness has four geometry modes — build123d B-rep, cadquery, raw mesh mode, and
`sdf_kit` (SDF skeleton + organic skin) — and the system prompt forces **one mode per
generation** (`lib/cad/prompt.ts:36-49`). But the parts we most want to be great at are
inherently multi-representation:

> A two-fluid heat exchanger = B-rep manifolds/flanges/ports (crisp, toleranced,
> STEP-able) + a gyroid TPMS core (implicit) + possibly a lofted shell.

Today the model must either fake the whole thing in mesh mode (losing crisp functional
features) or skip the core. The gyroid exemplar (`gyroid_tpms_core` in
`lib/cad/knowledge/exemplars.ts`) produces a bare cube of TPMS — a demo, not a part.

The SDF layer is the natural composition substrate because everything lowers into it:
B-rep solids can be voxelized to SDFs; TPMS/lattices are native; and `smin` blending is
what produces the draped-organic-skin default aesthetic the product wants.

`cad-runner/sdf_kit.py` today: ~100 lines — `smin/smax/union/intersect/subtract`,
`sphere/box/capsule/cyl_z`, `to_mesh` (grid sample + pad + marching cubes).

## Spec

### A. New primitives and operators (pure numpy, same vectorized `(P)->(N,)` contract)

- **TPMS fields**: `gyroid(P, cell, thickness)`, `schwarz_p(...)`, `diamond(...)`.
  Sheet form (`|g| - t`, two isolated networks) and solid-network form (`g - t`, one
  network). `cell` in mm; support spatially varying `thickness` (callable or per-point
  array) for graded cores.
- **Region masks**: `mask(field, region, k=0)` — apply a field only inside `region`
  (smooth-clipped); the tool for "gyroid only inside this jacket".
- **Shell/offset**: `shell(field, t)` = `abs(field) - t/2`; `offset(field, d)` = `field - d`.
- **Transforms**: `translate/rotate/scale` point-warpers (compose by warping `P`).
- **`from_mesh(trimesh, ...)`** — SDF of an arbitrary mesh via
  `trimesh.proximity.signed_distance` (slow but exact) or a precomputed voxel SDF +
  trilinear interpolation (fast; `scipy.ndimage.distance_transform_edt` on a filled voxel
  grid, signed by inside/outside). This is the **B-rep bridge**: build a flange in
  build123d, `from_mesh(brep_to_trimesh(flange))`, then `smin` it into an implicit body.
  Expose a convenience `from_solid(build123d_shape, pitch)` that tessellates then wraps.
- **`to_mesh` upgrades**: adaptive bounding (compute lo/hi from the anchors), optional
  `smooth_iters` (taubin via trimesh) to soften marching-cubes stairsteps *without*
  touching regions marked crisp (subtract-ed holes re-stamped after smoothing — v2 if
  hard).

Grid budget guidance moves from prose to code: `to_mesh` should raise a clear error when
the grid would exceed ~8M cells, naming the pitch that would fit — a self-explanatory
failure the repair loop can act on (compare the current opaque OOM/timeout death).

### B. The dual-network isolation verifier (the differentiator)

For exchanger-class parts, watertightness is not the interesting invariant — **network
topology** is: two fluid domains, each connected to its own inlet/outlet, with zero
cross-leak paths.

Sidecar addition (`cad-runner`): `check_networks(mesh_or_field, ports) -> report`.

- Voxelize the *void* space of the part's bounding region (invert the solid field or
  voxelize the mesh), run 26-connected component labeling (`scipy.ndimage.label`).
- `ports` = caller-declared inlet/outlet locations (spheres/cylinders in mm). Map each
  port to the component it lands in.
- Report: `{ components: n, portAssignment: {...}, isolated: bool  // the two port-pairs
  land in two distinct components and no third component touches both ports' faces,
  minWallVoxels: k  // thinnest solid separation between the two networks }`.
- Resolution honesty: report the voxel pitch used; isolation verified at pitch p means
  "no leak path wider than p" — state exactly that in the studio UI copy.
- Wire it as (a) an optional check in the one-shot `/run` payload, (b) a tool in the
  doc-03 agent loop, and (c) a `gradeRun` extension for prompts the router flags as
  multi-network (keyword/classifier: "heat exchanger", "two fluids", "manifold",
  "coolant"...). A failed isolation check is a repair-turn reason like any other.

### C. Prompt + exemplar coverage

- `SYSTEM_PROMPT` mesh-mode / SDF sections (`lib/cad/prompt.ts:36-49`) get the new
  vocabulary; the ORGANIC-FUNCTIONAL section explicitly gains "compose exact build123d
  anchors via `from_solid`".
- New verified exemplars (run through `scripts/verify-exemplars.ts`):
  1. **Heat-exchanger core with headers** — gyroid sheet core masked to a cylindrical
     jacket, two B-rep header caps bridged in via `from_solid`, ports declared, isolation
     check passing. This is the flagship; it should also become an eval case with
     `check_networks` in its grade.
  2. **Graded-density lattice bracket** — gyroid solid-network infill inside a shelled
     B-rep bracket, density graded toward the load path.
  3. **Lofted organic enclosure over a component stack** — pairs with doc 06's brief.
- Repair hints (`repairHintFor`, `lib/cad/harness.ts:168-186`): add cases for grid-too-
  large (name a coarser pitch), non-isolated networks (thicken sheet / close leak at
  reported location), and empty-field results.

## Acceptance

- Prompt "a compact two-fluid counterflow heat exchanger core, 60mm cube, G1/4 ports"
  produces: watertight mesh, `check_networks` reporting exactly 2 isolated networks each
  connected to its declared port pair, and a wall ≥ printable minimum at the reported
  pitch.
- A build123d flange composed via `from_solid` + `smin` into an SDF body keeps its bolt
  circle diameter within 0.2mm of spec (measure the mesh).
- All new exemplars pass `verify-exemplars`; new eval cases added to
  `scripts/evals/cases.ts` under a new `implicit-composite` tier.

## Open questions

1. `from_mesh` performance: signed_distance on ~1M sample points × complex mesh may need
   the precomputed-voxel-SDF path from day one. Spike first.
2. Where does port declaration come from in free-text prompts? Near-term: the model
   declares them in code (they're just positions). With doc 06, they come from the brief.
3. Crisp-feature re-stamping after smoothing (A, last bullet) — defer if fiddly.

## Dependencies

- None hard. Composes with doc 03 (verifier as agent tool) and doc 06 (ports/keep-outs
  from the brief). Heavier grids want doc 02's worker but v1 fits the 60s cap at
  pitch ≥ 0.5.
