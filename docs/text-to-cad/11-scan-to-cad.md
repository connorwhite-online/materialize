# 11 — Scan-to-CAD: geometry as a studio input

Owner ask (2026-08-14): *"What's the feasibility of using a lidar/3D scan of a
surface to base a CAD model generation off of? Imagining something like a scan
of an object and a prompt to make a case for it."*

**Verdict: the software was largely already here; the metrology is what limits
the product.** This doc records the accuracy budget, the proxy ladder, the
verification contract, and what a higher tier would take.

Written against the scan-to-CAD branch. Re-verify file:line pointers with a
drift check before editing.

## Why it was close to free

Four load-bearing pieces already existed:

1. **Mesh-in worked end to end.** `lib/cad/generative.ts:181-198` already
   downloaded an arbitrary GLB/OBJ/STL, `trimesh.load`ed it, and handed it to
   the sidecar, which repaired it (`app.py` `fix_winding`/`fix_normals`/
   `fill_holes`) and voxel-remeshed to watertight. A scan is the same payload.
2. **The voxel/SDF substrate is the right primitive for "make a cavity around
   this."** `sdf_kit._solid_voxels` returns a cavity-aware occupancy grid, and
   the smooth-union machinery is literally the drape recipe (MTR-192).
3. **The fit-verification pattern existed.** `fit.check_fit` voxelizes an
   enclosure and proves a component fits inside it.
4. **Importing foreign geometry into a session existed.**
   `POST /session/{id}/import_step` (MTR-200) — a 1:1 template for
   `import_mesh`.

## The accuracy budget (the actual constraint)

| Capture | Surface error | Enough for a snap fit? |
| --- | --- | --- |
| Phone lidar / ARKit | ±5–10 mm | No — off by ~40× |
| Photogrammetry (Object Capture) | ±2–3 mm relative, **scale ambiguous** | No |
| Structured-light scanner | ±0.05–0.1 mm | Yes |
| *What a press/snap fit needs* | *±0.2 mm* | — |

Two physical facts compound it, and neither is a software problem:

- **The resting face is never captured.** Every tabletop scan is a hemisphere
  with a hole where the object met the table.
- **Scans arrive noisy, non-manifold, and 100k–1M triangles**, usually with
  fragments of the table and the operator's hand attached.

**v1 therefore supports phone lidar only, loose fits only** — cradles, trays,
sleeves, stands, mounts, strap retention. Those are genuinely useful and
genuinely achievable at ±8 mm. A snap fit is not, and we do not offer one. The
budget lives in one place, `lib/cad/scan-tiers.ts`, so the promise the UI makes
is the promise the geometry enforces. The other tiers are declared but not
enabled; enabling one means proving its tolerance claim first, and for
photogrammetry it also means a scale-resolution step (one caliper measurement
rescales the whole capture).

## The proxy ladder

The scan is **never** used as a boolean operand. `scan_proxy.derive_proxy`
reduces it to a watertight *proxy solid* first.

| Level | Proxy | Good for | Why it survives a bad scan |
| --- | --- | --- | --- |
| `bbox` | Oriented bounding box | brackets, stands, wall mounts | Immune to noise and holes entirely |
| `hull` | Convex hull (**v1 default**) | cradles, trays, sleeves | Closes the missing bottom for free; noise can only push it outward |
| `offset` | Capped scan dilated by the clearance | cases following a concavity | Watertight by construction; concavity-aware |
| *`exact`* | *Simplified watertight scan* | *tight fits* | **Not implemented** — only pays off above phone-lidar accuracy |

**The proxy may only ever be LARGER than the object.** A case built oversize is
loose (recoverable); one built undersize does not close (scrap). Every level
either adds material outward or is a strict outer bound, and the error is
deliberately one-directional.

**Closure escalates** — plane-cap at the fitted resting plane → `fill_holes`
for the remaining dropouts → forced voxel closure → convex hull. Order matters:
`fill_holes` must run *after* the big cap, because with a hole the size of the
object's whole footprint still open it either no-ops or fills it at the wrong
height. Every degradation lands in `report["warnings"]` rather than being
applied silently.

**Frame contract:** the proxy is grounded on z=0 and footprint-aligned to X/Y.
Generated code may assume that; it may assume nothing about the scan's own
origin.

## The verification contract

`fit.check_scan_fit` is the proxy-envelope sibling of `check_fit`. Containment
and retention mirror the existing checks. **Extraction is new, and is the check
this feature actually needed:**

> A cradle can enclose a scanned object through an opening narrower than the
> object, be geometrically perfect, and be physically useless.

Nothing else in the suite would notice. It is verified by sweeping the proxy's
occupancy along the removal axis and asserting the path stays in air.

The three are only meaningful **together**. Containment is evaluated over the
proxy's *overlap* with the part — deliberately, so a tray that cups only the
bottom of an object can still be graded — which means a part far too small to
hold anything passes containment vacuously. Retention catches that one.
Extraction catches the part that holds the object too well.

## Findings worth keeping

Each of these cost real debugging time and is now covered by a test:

- **A non-zero EDT level sits on a plateau.** Every voxel a whole number of
  steps from an axis-aligned face holds exactly that distance, so marching
  cubes at an integer level meets a flat region rather than a crossing:
  measured 3,470 bodies and 3,114 non-manifold edges on a box-like hull.
  Regularized with a light gaussian, then nudged outward if it still will not
  close.
- **Seating is not collision.** An object resting in a cavity touches its
  floor by design; without a contact skin that reads as interference (a correct
  cup scored 98.6% and failed, with *every* offending cell in one layer at the
  seating plane). The skin is fixed in **millimetres**, not voxels, so the
  verdict does not move when the pitch does.
- **The proxy must be graded where the design puts it**, not where it was
  captured — hence the origin-pinning rule in the prompt contract.
- **Clearance is a resolution requirement, not a pitch.** Scaling the voxel
  pitch *up* with clearance coarsened the grid exactly when more accuracy was
  wanted; a 1 mm → 4 mm clearance change then grew the part by 1.2 mm instead
  of 3 mm.
- **The sidecar image ships no boolean engine** (no manifold3d, no blender).
  Neither the module nor its fixtures may use one — the test enclosures are
  built from voxel predicates instead.
- **`trimesh.voxelized` is pathological on fan-capped primitives** (27 s for a
  `creation.cylinder` vs 0.25 s for marching-cubes geometry of the same size).
  Production proxies are marching-cubes geometry, so this only ever bit a test
  fixture — but it is worth knowing before reaching for a primitive.
- **`method="ray"` voxelization is 40× faster and badly wrong** (97 % volume
  error). Do not adopt it.

## Shape of the integration

- Ingestion is a **shared** path (`lib/cad/geometry-refs.ts`), not a scan-only
  one. A phone scan and a user-uploaded STEP are the same input; only the
  sidecar-side reduction differs. MTR-207's remix workflow is the second
  consumer and needs no new pipe.
- Attachments are **studio input, not library artifacts** — no `files` /
  `fileAssets` row, so no `file_format` enum migration and no viewer,
  fingerprinting, thumbnail or CraftCloud surface to update.
- Ownership rides in the R2 key prefix (`cad-geo/<userId>/`) and is re-checked
  when the key comes back on the generate request.
- **A scan forces MESH mode.** The proxy *is* a mesh, so no B-rep kernel can
  boolean against it; `sdf_kit.from_mesh` is the bridge. Consequence: a
  scan-built part exports **no STEP**.
- **Attached geometry pins the route to the scripted harness.** The generative
  backend never sees the proxy, and the agentic loop has no scan tool yet —
  either would quietly ignore the object the user asked us to build around.
- The prompt contract is gated on the **payload**, not the words ("make a case
  for this" gives nothing away), and quotes the capture error next to the
  dimensions, because a model handed millimetres reaches for the tolerances
  millimetres usually imply.

## What is deferred

- **Surfacing the proxy report in the studio.** The sidecar returns it on
  `CadRunResult.scans` (level actually used, closed size, every degradation).
  Nothing renders it yet — a scan that could only be reduced to its convex hull
  currently says so only in the job trail.
- **The agentic path.** `import_mesh` and `importMeshIntoSession` exist and are
  tested; an `inspect_scan` tool and routing are not wired.
- **Higher capture tiers**, per the budget above.
- **Scan → editable parametric feature history.** MTR-207's tier 3, and still
  the hard problem: this ships geometry you can print, not a feature tree you
  can edit.
