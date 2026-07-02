# 01 — Selection fidelity: pick the face the user means

## Problem

The annotation tool (edge/face pick → note → folded into the revision prompt) is the
studio's best interaction pattern, but picking is finicky and does not match the user's
mental model on curved geometry. Clicking the barrel of a cylinder selects a thin band of
triangles near the click instead of the whole barrel; clicking near a fillet boundary
often selects nothing.

Two distinct defects, one shared root cause: selection runs on the **tessellated STL**,
which has no concept of the CAD faces/edges the user perceives.

### Defect A — face flood-fill compares to the seed, not the neighbor

`selectConnectedFace` (`components/viewer/model-viewer.tsx:183-237`) flood-fills from the
clicked triangle through edge-adjacent neighbors whose normal stays within **~5° of the
seed triangle's normal** (`COS = cos(5°)`, accepted iff `tn.dot(sn) >= COS`, `:194-210`).
On a curved surface the normal rotates continuously, so the fill halts ~5° of curvature
away from the click. The code itself flags this (`:180-181`): "Curved faces stop at their
curvature; true face identity needs STEP BRep topology (CON-182 v2)."

### Defect B — smooth-tangent edges are structurally unselectable

Edge picking (`selectNearestEdge`, `model-viewer.tsx:267-321`) searches segments produced
by `three.EdgesGeometry(geom, 25)` — a **25° dihedral threshold**. An edge where surfaces
meet tangentially (a fillet's boundary, a loft seam, the rim of a smoothly blended boss)
has near-zero dihedral angle and is never emitted, so it can never be picked. These are
exactly the edges a design-focused user wants to annotate ("make this fillet larger").

### Where selection data goes

Annotations are serialized to **text in model-space mm** and appended to the revision
prompt (`components/cad/text-to-cad-studio.tsx:526-548`): e.g. `#1 — face centered at
(12.1, 3.0, 8.2), ~40x20mm, normal (0,0,1): make this thinner`. The revision model must
spatially reason its way from coordinates back to a line of build123d — fragile.

## Spec — Phase 1 (mesh-only, small): segment by feature-edge boundaries

Replace the seed-relative criterion with **neighbor-relative smoothness bounded by
feature edges**. A "face" becomes: the connected set of triangles reachable from the seed
without crossing (a) a feature edge (dihedral > ~25°, reuse the existing
`getFeatureEdges` threshold) or (b) a neighbor-to-neighbor normal jump > ~5°. On a
cylinder, adjacent triangles differ by only a few degrees, so the fill walks the whole
barrel and stops at the end-cap feature edges — which is the optical face.

Implementation notes:

- `buildFaceAdjacency` (`model-viewer.tsx:93-173`) already welds vertices (quantized key,
  `q = maxAxis * 1e-5`) and builds edge-adjacency + per-triangle normals. Extend the
  cached structure with a per-adjacent-pair "is feature edge" bit (dot of the two face
  normals < cos 25°), then change the flood-fill accept test in `selectConnectedFace`
  from `tri·seed >= cos5°` to `tri·neighbor >= cos5° && !isFeatureEdge(pair)`.
- Keep a triangle-count cap (e.g. 200k) as a runaway guard for noisy generative meshes.
- The highlight overlay (`FaceHighlight`, `:239-265`) and the annotation payload already
  take arbitrary `positions[]` — no change downstream.
- Face metadata: with larger regions, the current bbox `extent` is more meaningful;
  additionally classify the region cheaply (fit a plane / cylinder via normal variance)
  and include `kind: "planar" | "curved"` in the serialized annotation text.

Acceptance:
- Clicking anywhere on a cylinder barrel (e.g. the `ergonomic_knob` exemplar) highlights
  the full barrel as one face.
- Clicking a flat face still selects exactly that flat face, stopping at chamfers.
- Orbit/drag disambiguation (`e.delta > 4`, `:594`) unchanged; pick latency remains
  imperceptible on a 100k-triangle mesh (adjacency is cached on `geom.userData`).

## Spec — Phase 2 (the real fix): export B-rep face/edge identity from the sidecar

The sidecar holds the actual OpenCASCADE B-rep before it exports STL. Tessellate **per
face** and ship identity to the viewer.

Sidecar (`cad-runner/app.py`, `_process_shape`):

- For build123d/cadquery results, iterate `TopoDS_Face`s (via OCP: `TopExp_Explorer` /
  build123d's `shape.faces()`), triangulate each (`BRepMesh_IncrementalMesh` +
  `BRep_Tool.Triangulation`), and emit a **topology sidecar** alongside the STL:
  ```jsonc
  {
    "faces": [ { "id": 0, "surface": "cylinder", "params": {"radius": 2.7, "axis": [0,0,1]},
                 "triRange": [startTri, endTri] } ],
    "edges": [ { "id": 0, "curve": "circle", "polyline": [[x,y,z], ...],
                 "faceIds": [0, 3] } ]
  }
  ```
  Emit triangles in face order so `triRange` indexes the STL triangle list directly (the
  triangle order of the exported STL must come from the same tessellation — export the
  mesh we build from the per-face triangulations rather than calling `export_stl`
  separately, or accept a GLB path instead: encode `faceId` as a per-vertex attribute).
- Surface classification comes free from OCC (`BRepAdaptor_Surface().GetType()`:
  plane/cylinder/cone/sphere/torus/bspline), same for edges via `BRepAdaptor_Curve`.
- Mesh-mode / sdf_kit / generative results have no B-rep: omit the sidecar; the viewer
  falls back to Phase 1 segmentation. This is fine — organic surfaces have no crisp face
  identity to preserve.
- Payload budget: topology JSON for typical parts is tens of KB; gate behind a request
  flag (`formats: [..., "topo"]`) so the eval runner can skip it.

Persistence: store the topology JSON in R2 next to the render
(`cad-topo/{userId}/{nanoid}.json`, mirroring `cad-renders/`), key on a new
`cadGenerations.topoStorageKey` column; serve via a signed URL like the render. (Include
this key in the GC work in doc 05.)

Viewer:

- Load the topology sidecar with the STL. Picking becomes exact: raycast → `faceIndex` →
  binary-search `triRange` → face id; highlight = that range. Edges render from real
  B-rep polylines (fat lines, as today) — including smooth-tangent edges, fixing
  Defect B outright. Delete the flood-fill/EdgesGeometry path for parts that have topology.
- Annotation payload upgrades from coordinates to **semantic handles**:
  `face #7 (cylinder r=2.7, axis Z) — "make this bore 3.4mm"`. Keep the mm coordinates as
  a fallback channel; both go into the revision prompt.

Harness follow-through (what makes this pay off): the revision prompt can now say
"the user selected the cylindrical face with radius 2.7 at (x,y,z)" — a code model can
find `hole_d = 5.5` in a parametric script from that description far more reliably than
from a bare centroid. No harness code change needed beyond the serialization in
`text-to-cad-studio.tsx:526-548`.

Acceptance:
- Clicking a fillet selects the whole fillet face; its boundary edges are selectable.
- Face pick on a 50-face part is exact (no threshold tuning).
- STEP/B-rep-less generations degrade gracefully to Phase 1 behavior.
- Annotation text includes surface type + parameters when topology is present.

## Non-goals

- Selection on multi-part assemblies beyond the active part (the studio shows one part
  at a time via the part selector).
- Persistent anchoring of annotations across regenerations (face ids are not stable
  across code changes; annotations remain per-version, as today — they're already
  dropped when the viewed asset changes, `text-to-cad-studio.tsx:326-329`).

## Dependencies / sequencing

Phase 1 is standalone and immediately shippable. Phase 2 touches the sidecar contract
(`CadRunResult`), persistence, and the viewer; land it behind a capability flag on the
run payload so old rows (no topo key) keep working. Related: MTR-35 (annotation v1,
shipped), legacy CON-182 v2 note in code comments.
