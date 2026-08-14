"""
Scan proxy derivation: turn a raw 3D scan (phone lidar / photogrammetry) into
a watertight PROXY SOLID that generated CAD can safely boolean against.

Why a proxy at all — a raw scan is noisy, non-manifold, 100k-1M triangles,
and, because the object was resting on a surface when it was captured, it is
missing its entire bottom face. Handing that to a CSG kernel yields a crash
or silent garbage. So we never boolean the scan; we derive a closed,
simplified stand-in and design against that.

ACCURACY POSTURE (v1 = phone lidar). ARKit-class reconstruction lands around
+/-5-10mm of surface error with drift across a sweep -- an order of magnitude
coarser than a press fit needs. The proxy is therefore deliberately
CONSERVATIVE: it may only ever be LARGER than the true object, never smaller.
Every level either adds material outward (hull, offset) or is a strict outer
bound (bbox). A case built to an oversized proxy is loose; one built to an
undersized proxy does not close. Loose is recoverable, not-closing is scrap.

Proxy ladder (`level`):
  0 "bbox"    oriented bounding box. Immune to noise and holes entirely.
  1 "hull"    convex hull. DEFAULT -- closes the missing bottom for free, and
              scan noise can only ever push a hull outward.
  2 "offset"  the capped scan itself, dilated by the clearance. Follows
              concavities; watertight by construction (marching cubes).
  ("exact" -- a simplified watertight scan used directly -- is deliberately
   NOT implemented. It only pays off above phone-lidar accuracy; see
   docs/text-to-cad/11-scan-to-cad.md.)

Clearance is applied by the SAME outward offset for `hull` and `offset` (an
EDT level-set, the sub-voxel-accurate idiom already used by app.py's voxel
remesh) and analytically for `bbox`, so "clearance" means one thing at every
level.

`derive_proxy` never raises for a bad scan: it degrades down the ladder and
records what it did in the report, so the harness can tell the model "the
bottom was closed by hull fallback" instead of silently designing against a
lie. Every degradation appends to report["warnings"].

Frame contract: the returned proxy is grounded and axis-aligned -- it rests
on z=0 (the surface the object was scanned on) with its minimal-area
footprint rectangle aligned to X/Y. Generated code may assume that; it must
NOT assume anything about the incoming scan's own origin.
"""
import numpy as np

__all__ = ["derive_proxy", "PROXY_LEVELS"]

PROXY_LEVELS = ("bbox", "hull", "offset")

# Debris filter: drop connected components smaller than this fraction of the
# largest one's bbox diagonal. Phone scans routinely carry floating shards of
# the table and the operator's hand.
_DEBRIS_FRAC = 0.15
# Voxel budget for the offset level (same order as fit.py's).
_MAX_VOXELS = 4.5e6
# A boundary loop must have at least this many vertices to be trusted as the
# resting-surface opening rather than a stray puncture.
_MIN_BOUNDARY_VERTS = 8
# Max out-of-plane / in-plane spread for a rim to be trusted as the
# resting surface. Above this it is a torn shell, not a table contact.
_RIM_PLANARITY_MAX = 0.35


def _bbox_diag(mesh):
    ext = np.asarray(mesh.extents, float)
    if not np.all(np.isfinite(ext)):
        return 0.0
    return float(np.linalg.norm(ext))


def _clean(mesh, report):
    """Weld, drop degenerate faces, and strip disconnected scan debris."""
    import trimesh

    m = mesh.copy()
    try:
        m.merge_vertices()
        m.remove_degenerate_faces()
        m.remove_duplicate_faces()
        m.remove_unreferenced_vertices()
    except Exception as err:  # noqa: BLE001 -- cleaning is best-effort
        report["warnings"].append(f"mesh cleanup partially failed: {err}")

    try:
        bodies = m.split(only_watertight=False)
        if len(bodies) > 1:
            diags = [_bbox_diag(b) for b in bodies]
            keep_over = max(diags) * _DEBRIS_FRAC
            kept = [b for b, d in zip(bodies, diags) if d >= keep_over]
            if kept and len(kept) < len(bodies):
                report["warnings"].append(
                    f"dropped {len(bodies) - len(kept)} disconnected "
                    "fragment(s) as scan debris"
                )
                m = (
                    trimesh.util.concatenate(kept)
                    if len(kept) > 1
                    else kept[0]
                )
    except Exception as err:  # noqa: BLE001
        report["warnings"].append(f"debris filter skipped: {err}")
    return m


def _open_edges(mesh):
    """Edges referenced by exactly one face -- the scan's open boundary."""
    edges = np.asarray(mesh.edges_sorted)
    if len(edges) == 0:
        return np.empty((0, 2), int)
    uniq, counts = np.unique(edges, axis=0, return_counts=True)
    return uniq[counts == 1]


def _resting_rim(mesh):
    """Vertices of the LARGEST open-boundary loop.

    A scan usually has several holes -- the big one where the object met the
    surface, plus punctures wherever the capture missed. Fitting a plane to
    all of them at once averages a puncture on the far side into the resting
    plane and tilts it, so components are separated first (by total edge
    length) and only the dominant loop is trusted."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    oe = _open_edges(mesh)
    if len(oe) == 0:
        return np.empty((0, 3))
    verts = np.asarray(mesh.vertices, float)
    idx = np.unique(oe)
    rows = np.searchsorted(idx, oe[:, 0])
    cols = np.searchsorted(idx, oe[:, 1])
    graph = coo_matrix(
        (np.ones(len(rows)), (rows, cols)), shape=(len(idx), len(idx))
    )
    n_comp, labels = connected_components(graph, directed=False)
    if n_comp <= 1:
        return verts[idx]
    lengths = np.linalg.norm(verts[oe[:, 0]] - verts[oe[:, 1]], axis=1)
    totals = np.bincount(labels[rows], weights=lengths, minlength=n_comp)
    return verts[idx[labels == int(np.argmax(totals))]]


def _fit_plane_robust(points):
    """Least-squares plane with one outlier-rejection pass.

    A dropout elsewhere in the scan can merge into the resting rim's loop and
    drag a plain fit off true, so the worst-residual quarter is discarded and
    the plane refitted. Returns (centroid, normal, planarity_ratio, n_kept);
    the ratio is out-of-plane spread over in-plane spread, so smaller is
    flatter and None means degenerate."""
    pts = np.asarray(points, float)

    def fit(p):
        c = p.mean(axis=0)
        _, sv, vh = np.linalg.svd(p - c, full_matrices=False)
        ratio = float(sv[2] / sv[1]) if sv[1] > 1e-9 else None
        return c, np.asarray(vh[2], float), ratio

    centroid, normal, ratio = fit(pts)
    kept = len(pts)
    if len(pts) >= 2 * _MIN_BOUNDARY_VERTS:
        resid = np.abs((pts - centroid) @ normal)
        cutoff = float(np.quantile(resid, 0.75))
        inliers = pts[resid <= max(cutoff, 1e-9)]
        if len(inliers) >= _MIN_BOUNDARY_VERTS:
            c2, n2, r2 = fit(inliers)
            if r2 is not None and (ratio is None or r2 < ratio):
                return c2, n2, r2, len(inliers)
    return centroid, normal, ratio, kept


def _ground_transform(mesh, report):
    """4x4 putting the resting surface at z=0 with the object above it.

    The resting surface is fitted to the open-boundary rim when there is one
    (a tabletop scan), else taken as the bottom of the mesh in its principal
    frame. Returns (transform, fitted_bool)."""
    import trimesh

    verts = np.asarray(mesh.vertices, float)
    rim = _resting_rim(mesh)
    fitted = False
    if len(rim) >= _MIN_BOUNDARY_VERTS:
        centroid, normal, ratio, kept = _fit_plane_robust(rim)
        # Planarity gate: the rim is a usable resting surface only when its
        # out-of-plane spread is small next to its in-plane spread.
        if ratio is not None and ratio < _RIM_PLANARITY_MAX:
            fitted = True
            # Point the normal at the body, so the object ends up ABOVE z=0.
            if np.dot(verts.mean(axis=0) - centroid, normal) < 0:
                normal = -normal
            report["groundPlane"] = "fitted to open-boundary rim"
            report["rimVertices"] = int(len(rim))
            if kept < len(rim):
                report["rimOutliersDropped"] = int(len(rim) - kept)
        else:
            report["warnings"].append(
                "open boundary is not planar enough to be the resting "
                "surface; grounding on the bounding box instead"
            )
    if not fitted:
        normal = np.array([0.0, 0.0, 1.0])
        centroid = verts.mean(axis=0)
        report.setdefault("groundPlane", "bounding-box minimum (no open rim)")

    rot = trimesh.geometry.align_vectors(normal, np.array([0.0, 0.0, 1.0]))
    moved = trimesh.transform_points(verts, rot)
    # Drop the plane to z=0: the fitted rim's height when we trust it,
    # otherwise the lowest vertex.
    if fitted:
        z0 = float(trimesh.transform_points(centroid[None, :], rot)[0][2])
    else:
        z0 = float(moved[:, 2].min())
    rot[2, 3] -= z0
    return rot, fitted


def _align_footprint(mesh):
    """Rotate about Z so the minimal-area footprint rectangle is axis-aligned.

    Purely a convenience for the generator ('the object is 80 x 45 x 30mm'),
    and it never moves the ground plane."""
    import trimesh

    try:
        pts = np.asarray(mesh.convex_hull.vertices, float)[:, :2]
        to_rect, _ = trimesh.bounds.oriented_bounds_2D(pts)
        theta = float(np.arctan2(to_rect[1, 0], to_rect[0, 0]))
    except Exception:  # noqa: BLE001 -- alignment is cosmetic
        return np.eye(4)
    c, s = np.cos(theta), np.sin(theta)
    rot = np.eye(4)
    rot[:2, :2] = [[c, -s], [s, c]]
    return rot


def _close_small_holes(mesh, report):
    """Close capture dropouts in place. Best-effort: reports nothing on
    failure, since the caller checks watertightness for itself."""
    import trimesh

    try:
        trimesh.repair.fix_winding(mesh)
        trimesh.repair.fill_holes(mesh)
        trimesh.repair.fix_winding(mesh)
    except Exception as err:  # noqa: BLE001
        report["warnings"].append(f"hole filling skipped: {err}")
    return mesh


def _ball(radius):
    """Spherical structuring element of `radius` voxels."""
    r = int(max(1, radius))
    span = np.arange(-r, r + 1)
    gx, gy, gz = np.meshgrid(span, span, span, indexing="ij")
    return (gx * gx + gy * gy + gz * gz) <= r * r


def _voxel_close(mesh, report):
    """Force a scan closed through voxel space. Returns a mesh or None.

    The plane cap handles the resting-surface hole, but a noisy rim leaves it
    ragged and capture dropouts survive `fill_holes` (measured on a 5k-tri
    fixture: 81 open edges after the cap, 63 after filling). This is the
    guaranteed closure: surface-voxelize, morphologically CLOSE to bridge the
    remaining gaps, flood-fill everything the outside cannot reach, and
    marching-cubes it back.

    Unlike `_solid_voxels` this deliberately does NOT preserve internal
    cavities. A proxy stands in for the outside of a physical object; an
    interior void in it is a scan artifact, and leaving it would let the
    generator cut a pocket into thin air.

    Lossy at the pitch scale, which is why it is last and why the pitch is
    recorded -- for phone-lidar input the loss sits well inside the capture's
    own error."""
    import trimesh
    from scipy import ndimage as sp_ndimage
    from skimage import measure as sk_measure

    ext = np.asarray(mesh.extents, float)
    if not np.all(np.isfinite(ext)) or float(max(ext)) <= 0:
        return None
    pitch = max(float(max(ext)) / 140.0, 0.3)
    for _ in range(24):
        if np.prod(np.ceil(ext / pitch) + 24) <= _MAX_VOXELS:
            break
        pitch *= 1.25

    try:
        vg = mesh.voxelized(pitch)
        base = np.asarray(vg.matrix, bool)
        origin = np.asarray(vg.transform, float)[:3, 3]
    except Exception as err:  # noqa: BLE001
        report["warnings"].append(f"voxel closure could not voxelize: {err}")
        return None

    # Escalate the bridging radius: the smallest closure that seals wins, so
    # a scan with tight dropouts keeps more of its true surface.
    for radius in (1, 2, 3, 5):
        pad = radius + 4
        grid = np.pad(base, pad)
        try:
            if radius > 0:
                grid = sp_ndimage.binary_closing(
                    grid, structure=_ball(radius), border_value=0
                )
            lbl, n = sp_ndimage.label(~grid)
            if n == 0:
                continue
            outside = set()
            for face in (lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1],
                         lbl[:, :, 0], lbl[:, :, -1]):
                outside.update(np.unique(face).tolist())
            outside.discard(0)
            keep = np.zeros(n + 1, bool)
            if outside:
                keep[list(outside)] = True
            solid = grid | ~keep[lbl]
            if not solid.any():
                continue
            field = (
                sp_ndimage.distance_transform_edt(~solid)
                - sp_ndimage.distance_transform_edt(solid)
            ).astype(np.float32)
            verts, faces, _, _ = sk_measure.marching_cubes(field, level=0.0)
            out = trimesh.Trimesh(
                vertices=origin + (verts - pad) * pitch, faces=faces
            )
            out.merge_vertices()
            if float(out.volume) < 0:
                out.invert()
            out = _largest_body(out)
            if bool(out.is_watertight):
                report["closureRadiusVoxels"] = int(radius)
                report["closurePitchMm"] = round(pitch, 4)
                return out
        except Exception as err:  # noqa: BLE001 -- try a wider bridge
            report["warnings"].append(f"voxel closure r={radius} failed: {err}")
    return None


def _ground_and_cap(mesh, report):
    """Ground the scan, close it, and axis-align its footprint.

    Two kinds of hole need two different closures, and the order matters:

      * the RESTING-SURFACE hole is large and planar -- the object stood on a
        table, so the honest closure is a plane slice with a triangulated
        cap, not an interpolated dome;
      * capture DROPOUTS are small and scattered -- `fill_holes` closes those,
        and it must run AFTER the big cap, because with a hole the size of
        the object's whole footprint still open it either no-ops or fills it
        with a lid at the wrong height.

    Returns a mesh that is watertight when closing succeeded; the caller
    degrades to the convex hull when it did not."""
    import trimesh

    m = mesh.copy()
    grounded, fitted = _ground_transform(m, report)
    m.apply_transform(grounded)
    m.apply_transform(_align_footprint(m))

    if bool(m.is_watertight):
        report["bottomCapped"] = False
        report["capMethod"] = "none (scan was already closed)"
        return m

    # Dropouts only, no resting-surface hole: nothing to slice.
    small = _close_small_holes(m.copy(), report)
    if bool(small.is_watertight):
        report["bottomCapped"] = True
        report["capMethod"] = "fill_holes"
        return small

    # Slice a hair above the fitted plane so the jagged rim is cut away, cap
    # the clean cross-section, close whatever dropouts remain, then drop the
    # cap back to z=0.
    rim = _resting_rim(m)
    eps = 0.25
    if len(rim):
        eps = float(max(0.25, 1.5 * float(np.std(rim[:, 2]))))
    height = float(np.asarray(m.extents, float)[2])
    eps = min(eps, max(height * 0.1, 0.25))
    # `capped` is whatever is closest to closed so far -- the voxel closure
    # below needs the big resting-surface hole already covered, since no
    # morphological bridge spans the object's whole footprint.
    capped = m
    try:
        cut = trimesh.intersections.slice_mesh_plane(
            m, plane_normal=[0, 0, 1], plane_origin=[0, 0, eps], cap=True
        )
        if cut is not None and len(cut.faces):
            cut = _close_small_holes(cut, report)
            cut.apply_translation([0.0, 0.0, -eps])
            capped = cut
            if bool(cut.is_watertight):
                report["bottomCapped"] = True
                report["capMethod"] = f"planar slice + cap at {eps:.2f}mm"
                report["capTrimMm"] = round(eps, 3)
                if not fitted:
                    report["warnings"].append(
                        "resting surface was inferred from the bounding box, "
                        "not a fitted rim -- the cap plane may be tilted"
                    )
                return cut
    except Exception as err:  # noqa: BLE001 -- fall through to voxel closure
        report["warnings"].append(f"planar cap failed: {err}")

    # Last resort before the hull: force it closed in voxel space.
    forced = _voxel_close(capped, report)
    if forced is not None:
        report["bottomCapped"] = True
        report["capMethod"] = "voxel closure"
        report["warnings"].append(
            "the scan could not be closed by capping alone; it was forced "
            f"closed in voxel space at {report.get('closurePitchMm')}mm pitch "
            "-- surface detail below that pitch is lost"
        )
        return forced

    report["bottomCapped"] = False
    report["capMethod"] = "failed"
    report["warnings"].append(
        "could not close the scan's open bottom; falling back to the convex "
        "hull, which closes it unconditionally"
    )
    return m


def _offset_pitch(mesh, clearance_mm):
    """Voxel pitch for the offset level: fine enough to resolve the clearance
    band, coarse enough to fit the voxel budget."""
    ext = np.asarray(mesh.extents, float)
    span = float(max(ext)) if np.all(np.isfinite(ext)) else 100.0
    # The clearance band is a RESOLUTION REQUIREMENT, so it caps the pitch --
    # it does not raise it. Scaling pitch up with clearance (the first cut of
    # this) coarsened the grid exactly when more accuracy was wanted, and the
    # gaussian regularization then rounded the proxy's extremes off: a 1mm ->
    # 4mm clearance change grew the height by 1.2mm instead of 3mm.
    pitch = span / 120.0
    if clearance_mm > 0:
        pitch = min(pitch, clearance_mm / 2.0)
    grown = ext + 2.0 * clearance_mm
    for _ in range(24):
        if np.prod(np.ceil(grown / pitch) + 10) <= _MAX_VOXELS:
            break
        pitch *= 1.25
    return float(pitch)


def _largest_body(mesh):
    """Keep the biggest connected body. A proxy must be ONE solid: marching
    cubes over a quantized field can shed slivers, and a stray shard would
    later be booleaned into the case as a phantom obstruction."""
    try:
        bodies = mesh.split(only_watertight=False)
    except Exception:  # noqa: BLE001 -- splitting is best-effort
        return mesh
    if len(bodies) <= 1:
        return mesh
    return max(bodies, key=lambda b: abs(float(b.volume)))


def _offset_solid(mesh, clearance_mm, report, floor_z=None):
    """Dilate a watertight mesh outward by `clearance_mm`.

    An EDT level-set rather than a binary dilation: marching cubes
    interpolates along the field gradient, so the offset surface lands at
    sub-voxel positions instead of snapping to mid-cell and shipping a
    staircase (the same reasoning as app.py's voxel remesh).

    Two things the plain remesh does not have to worry about, because it cuts
    at level 0 where the discrete EDT never lands exactly:

    1. A NON-ZERO level sits on a PLATEAU. Every voxel a whole number of
       steps from an axis-aligned face holds exactly that distance, so
       marching cubes at an integer level meets a flat region rather than a
       crossing and returns shattered, non-manifold debris (measured on a
       box-like hull: 3,470 bodies, 3,114 non-manifold edges). A light
       gaussian regularization removes the plateaus while moving the level
       set by far less than the scan's own error.
    2. Quantization slivers -- hence `_largest_body`.

    `floor_z` truncates the result at a plane. It is applied INSIDE the field
    (as a ramp whose zero-crossing lands exactly on the plane) rather than by
    slicing the finished mesh, because a post-hoc `slice_mesh_plane` has to
    re-cap a dense marching-cubes surface and intermittently fails to close
    it -- and the sidecar image ships no boolean engine to fall back on.

    Raises when it cannot produce a closed solid; `derive_proxy` degrades."""
    import trimesh
    from scipy import ndimage as sp_ndimage
    from skimage import measure as sk_measure

    from sdf_kit import _solid_voxels

    pitch = _offset_pitch(mesh, clearance_mm)
    pad = int(np.ceil(clearance_mm / pitch)) + 4
    solid, origin = _solid_voxels(mesh, pitch, pad=pad)
    if not solid.any():
        raise ValueError("voxelization produced no solid material")
    # Signed distance in voxels: positive outside, negative inside, zero on
    # the surface. The offset surface is the level set at clearance/pitch.
    field = (
        sp_ndimage.distance_transform_edt(~solid)
        - sp_ndimage.distance_transform_edt(solid)
    ).astype(np.float32)
    field = sp_ndimage.gaussian_filter(field, sigma=0.6)
    level = float(clearance_mm) / pitch

    if floor_z is not None:
        # Ramp the field upward below the floor so the iso-surface crosses
        # exactly at `floor_z`; marching cubes then closes the bottom itself.
        k0 = (float(floor_z) - float(origin[2])) / pitch
        below = int(np.ceil(k0))
        if 0 < below < field.shape[2]:
            ks = np.arange(below)
            field[:, :, :below] = (level + 1.0 + (k0 - ks))[None, None, :]

    last = None
    # Nudges are sub-voxel and OUTWARD, keeping the proxy conservative if the
    # exact level is unusable.
    for bump in (0.0, 0.17, 0.41):
        verts, faces, _, _ = sk_measure.marching_cubes(field, level=level + bump)
        out = trimesh.Trimesh(vertices=origin + verts * pitch, faces=faces)
        out.merge_vertices()
        # No fix_normals: marching cubes orients from the field gradient,
        # which is already globally consistent. Guard only a global inversion.
        if float(out.volume) < 0:
            out.invert()
        out = _largest_body(out)
        last = out
        if bool(out.is_watertight):
            report["pitchMm"] = round(pitch, 4)
            if bump:
                report["warnings"].append(
                    f"offset level nudged {bump * pitch:.2f}mm outward to "
                    "clear a degenerate iso-surface"
                )
            return out
    report["pitchMm"] = round(pitch, 4)
    raise ValueError(
        "offset surface did not close"
        + (f" ({len(last.faces)} faces)" if last is not None else "")
    )


def _flatten_bottom(mesh, report):
    """Re-cut the proxy at z=0 and cap it.

    The object rests ON the surface, so the clearance band belongs around and
    above it, never underneath -- an offset proxy that bulges below z=0 would
    push the case floor away from the part it is meant to support."""
    import trimesh

    if float(np.asarray(mesh.bounds, float)[0][2]) >= -1e-6:
        return mesh
    try:
        cut = trimesh.intersections.slice_mesh_plane(
            mesh, plane_normal=[0, 0, 1], plane_origin=[0, 0, 0], cap=True
        )
        if cut is not None and len(cut.faces) and bool(cut.is_watertight):
            return cut
    except Exception as err:  # noqa: BLE001 -- a bulging bottom is survivable
        report["warnings"].append(f"bottom flatten failed: {err}")
    report["warnings"].append("proxy extends below the resting plane")
    return mesh


def _obb_solid(mesh, clearance_mm):
    """Grown axis-aligned box. The mesh is already footprint-aligned, so its
    AABB *is* the oriented bounding box."""
    import trimesh

    lo, hi = np.asarray(mesh.bounds, float)
    # Clearance all round, except below: the object sits on the surface.
    lo = lo - clearance_mm
    hi = hi + clearance_mm
    lo[2] = max(0.0, float(np.asarray(mesh.bounds, float)[0][2]))
    ext = np.maximum(hi - lo, 1e-3)
    box = trimesh.creation.box(extents=ext)
    box.apply_translation((lo + hi) / 2.0)
    return box


def derive_proxy(mesh, level="hull", clearance_mm=2.0, flat_bottom=True):
    """Derive a watertight proxy solid from a raw scan.

    Returns (proxy_mesh, report). Never raises for a recoverable scan defect:
    a level that cannot be built degrades to the next more robust one and the
    reason lands in report["warnings"].
    """
    level = str(level or "hull").lower()
    if level not in PROXY_LEVELS:
        level = "hull"
    clearance_mm = max(float(clearance_mm or 0.0), 0.0)

    report = {
        "requestedLevel": level,
        "level": level,
        "clearanceMm": round(clearance_mm, 3),
        "warnings": [],
        "inputTriangles": int(len(mesh.faces)),
    }

    cleaned = _clean(mesh, report)
    grounded = _ground_and_cap(cleaned, report)

    # A level that needs a closed base cannot run on a scan we failed to cap.
    if level == "offset" and not bool(grounded.is_watertight):
        report["warnings"].append(
            "offset level needs a closed base; degraded to hull"
        )
        level = "hull"

    proxy = None
    if level == "offset":
        try:
            proxy = _offset_solid(grounded, clearance_mm, report, floor_z=0.0)
        except Exception as err:  # noqa: BLE001 -- degrade, never fail
            report["warnings"].append(f"offset proxy failed ({err}); using hull")
            level = "hull"

    if proxy is None and level == "hull":
        try:
            hull = grounded.convex_hull
            proxy = (
                _offset_solid(hull, clearance_mm, report, floor_z=0.0)
                if clearance_mm > 0
                else hull
            )
        except Exception as err:  # noqa: BLE001
            report["warnings"].append(f"hull proxy failed ({err}); using bbox")
            level = "bbox"

    if proxy is None:
        level = "bbox"
        proxy = _obb_solid(grounded, clearance_mm)

    if flat_bottom:
        proxy = _flatten_bottom(proxy, report)

    lo, hi = np.asarray(proxy.bounds, float)
    report["level"] = level
    report["proxyTriangles"] = int(len(proxy.faces))
    report["watertight"] = bool(proxy.is_watertight)
    report["sizeMm"] = [round(float(v), 3) for v in (hi - lo)]
    report["bboxMm"] = {
        "min": [round(float(v), 3) for v in lo],
        "max": [round(float(v), 3) for v in hi],
    }
    report["volumeMm3"] = round(abs(float(proxy.volume)), 3)
    if not report["watertight"]:
        report["warnings"].append(
            "proxy is not watertight -- treat every fit result as advisory"
        )
    return proxy, report
