"""
Tests for scan ingestion: the proxy ladder (scan_proxy) and the scan-fit
verifier (fit.check_scan_fit).

Fixtures are built to look like what a phone actually hands us -- a dense,
non-convex surface with its resting face missing (occlusion), capture
dropouts, vertex noise at lidar scale, and a floating shard of the table --
because every failure these modules exist to survive comes from exactly those
four defects, and a clean primitive exercises none of them.

Needs only trimesh + scipy + scikit-image, NOT a CAD kernel, so unlike
test_fit.py this runs anywhere the sidecar's mesh stack is installed.

Run: `python3 cad-runner/tests/test_scan_proxy.py`
"""
import os
import sys
import time
import traceback
from pathlib import Path

os.environ["CAD_RUNNER_ALLOW_NO_AUTH"] = "true"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import trimesh

from fit import check_scan_fit
from scan_proxy import derive_proxy

CUT_MM = 4.0  # how much of the object the table hid


# ---- fixtures ----------------------------------------------------------------
def waisted_object():
    """A dense, NON-CONVEX object: an ellipsoid pinched into a waist. The
    concavity is the point -- it is what separates the hull level (bridges it)
    from the offset level (follows it)."""
    m = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    v = m.vertices.copy()
    waist = 1.0 - 0.30 * np.exp(-((v[:, 2] - 0.1) / 0.32) ** 2)
    v[:, 0] *= 40 * waist
    v[:, 1] *= 24 * waist
    v[:, 2] *= 20
    m.vertices = v
    m.apply_translation([0, 0, -m.bounds[0][2]])
    return m


def truth_above_cut(cut=CUT_MM):
    """The part of the object a tabletop scan could actually see, closed off
    -- the ground truth a conservative proxy must contain."""
    t = trimesh.intersections.slice_mesh_plane(
        waisted_object(), [0, 0, 1], [0, 0, cut], cap=True
    )
    t.apply_translation([0, 0, -cut])
    return t


def fake_scan(seed=3, noise=0.6, cut=CUT_MM, dropout=8, tilt=0.0,
              debris=True, shred=0.0):
    """A scan-shaped surface carrying all four real defects."""
    rng = np.random.default_rng(seed)
    m = waisted_object()
    if cut:
        m = trimesh.intersections.slice_mesh_plane(m, [0, 0, 1], [0, 0, cut],
                                                   cap=False)
        m.merge_vertices()  # a real scan arrives welded
    if dropout:
        top = np.argsort(m.triangles_center[:, 2])[-dropout:]
        keep = np.ones(len(m.faces), bool)
        keep[top] = False
        m.update_faces(keep)
        m.remove_unreferenced_vertices()
    if shred:
        keep = rng.random(len(m.faces)) > shred
        m.update_faces(keep)
        m.remove_unreferenced_vertices()
    if noise:
        m.vertices = m.vertices + rng.normal(0, noise, m.vertices.shape)
    if tilt:
        m.apply_transform(
            trimesh.transformations.rotation_matrix(np.radians(tilt), [0, 1, 0])
        )
    if debris:
        d = trimesh.creation.icosphere(subdivisions=2, radius=2.0)
        d.apply_translation([-80, 35, 4])
        m = trimesh.util.concatenate([m, d])
    return m


def solid_from(predicate, lo, hi, pitch=0.8):
    """Mesh the region where `predicate(X, Y, Z)` is true.

    The enclosure fixtures below are cavities cut out of blocks, which is
    naturally a boolean difference -- but the sidecar image ships NO boolean
    engine (no manifold3d, no blender; see requirements.txt), so a fixture
    built with `trimesh.boolean` would pass here and fail in the only
    environment that counts. Predicates over a voxel grid need nothing beyond
    the mesh stack the module under test already uses."""
    from scipy import ndimage
    from skimage import measure as sk_measure

    lo = np.asarray(lo, float)
    axes = [np.arange(lo[i], np.asarray(hi, float)[i] + pitch, pitch)
            for i in range(3)]
    grid = np.meshgrid(*axes, indexing="ij")
    pad = 2
    occ = np.pad(np.asarray(predicate(*grid), bool), pad)
    field = (ndimage.distance_transform_edt(~occ)
             - ndimage.distance_transform_edt(occ)).astype(np.float32)
    verts, faces, _, _ = sk_measure.marching_cubes(field, level=0.0)
    mesh = trimesh.Trimesh(
        vertices=lo - pad * pitch + verts * pitch, faces=faces
    )
    mesh.merge_vertices()
    if float(mesh.volume) < 0:
        mesh.invert()
    return mesh


def block(w, d, h, z=0.0):
    """Predicate for an axis-aligned block centred on XY, based at `z`."""
    return lambda X, Y, Z: (
        (np.abs(X) <= w / 2) & (np.abs(Y) <= d / 2) & (Z >= z) & (Z <= z + h)
    )


def tube(r, h, z=0.0):
    """Predicate for an upright cylindrical cavity."""
    return lambda X, Y, Z: (
        (X * X + Y * Y <= r * r) & (Z >= z) & (Z <= z + h)
    )


def carve(outer, *cavities, lo=(-34, -34, -8), hi=(34, 34, 70)):
    """`outer` minus every cavity, meshed."""
    def pred(X, Y, Z):
        keep = outer(X, Y, Z)
        for cav in cavities:
            keep = keep & ~cav(X, Y, Z)
        return keep
    return solid_from(pred, lo, hi)


# ---- proxy ladder ------------------------------------------------------------
def test_every_level_closes_a_defective_scan():
    """The contract the whole feature rests on: whatever the scan's state, each
    level returns a closed solid a CSG kernel will accept."""
    scan = fake_scan()
    assert not scan.is_watertight, "fixture must start open, or it proves nothing"
    for level in ("bbox", "hull", "offset"):
        proxy, report = derive_proxy(scan, level=level, clearance_mm=3.0)
        assert proxy.is_watertight, f"{level}: proxy not watertight"
        assert proxy.is_volume, f"{level}: proxy is not a volume — booleans will fail"
        assert report["level"] == level, (
            f"{level} degraded to {report['level']}: {report['warnings']}"
        )
        assert report["watertight"] is True


def test_proxy_rests_on_z0():
    """Grounding contract: generated code may assume the object sits on z=0."""
    for level in ("bbox", "hull", "offset"):
        proxy, _ = derive_proxy(fake_scan(), level=level, clearance_mm=3.0)
        low = float(proxy.bounds[0][2])
        assert abs(low) < 0.6, f"{level}: proxy bottom at z={low:.3f}, not 0"


def test_proxy_is_conservative():
    """A proxy may only ever be LARGER than the object. Undersized means the
    case does not close (scrap); oversized means it is loose (recoverable), so
    the error is deliberately one-directional.

    Compared on SORTED extents + volume, which are invariant to the footprint
    alignment the proxy pipeline applies."""
    truth = truth_above_cut()
    t_ext = np.sort(np.asarray(truth.extents, float))
    t_vol = abs(float(truth.volume))
    for level in ("bbox", "hull", "offset"):
        proxy, _ = derive_proxy(fake_scan(), level=level, clearance_mm=3.0)
        p_ext = np.sort(np.asarray(proxy.extents, float))
        assert np.all(p_ext >= t_ext - 1e-6), (
            f"{level}: proxy {np.round(p_ext, 2)} smaller than object "
            f"{np.round(t_ext, 2)}"
        )
        assert abs(float(proxy.volume)) >= t_vol, (
            f"{level}: proxy volume {float(proxy.volume):.0f} < object {t_vol:.0f}"
        )


def test_offset_follows_the_concavity_hull_bridges():
    """Why the offset level exists at all: on a waisted object it must enclose
    LESS dead space than the convex hull, or the ladder has only one rung."""
    scan = fake_scan()
    hull, _ = derive_proxy(scan, level="hull", clearance_mm=3.0)
    offset, _ = derive_proxy(scan, level="offset", clearance_mm=3.0)
    assert abs(float(offset.volume)) < abs(float(hull.volume)) * 0.95, (
        f"offset {float(offset.volume):.0f} did not beat hull "
        f"{float(hull.volume):.0f} on a concave object"
    )


def test_clearance_grows_the_proxy():
    """Clearance must mean millimetres, at every level."""
    scan = fake_scan()
    for level in ("bbox", "hull", "offset"):
        tight, _ = derive_proxy(scan, level=level, clearance_mm=1.0)
        loose, _ = derive_proxy(scan, level=level, clearance_mm=4.0)
        grew = np.sort(np.asarray(loose.extents, float)) - np.sort(
            np.asarray(tight.extents, float)
        )
        # 3mm more clearance per side = ~6mm per axis; allow generous slack for
        # voxel pitch, but the sign and rough scale must be right.
        assert np.all(grew > 2.0), f"{level}: extents grew only {np.round(grew, 2)}"
        assert np.all(grew < 10.0), f"{level}: extents grew {np.round(grew, 2)}, too much"


def test_debris_is_dropped():
    """A shard of the table 80mm away must not drag the proxy across the room."""
    proxy, report = derive_proxy(fake_scan(debris=True), level="hull",
                                 clearance_mm=3.0)
    assert any("debris" in w for w in report["warnings"]), report["warnings"]
    assert float(proxy.extents[0]) < 110.0, (
        f"proxy spans {float(proxy.extents[0]):.1f}mm — it swallowed the debris"
    )


def test_tilted_capture_is_grounded():
    """A scan captured off-axis must land flat, matching the untilted result."""
    flat, _ = derive_proxy(fake_scan(), level="hull", clearance_mm=3.0)
    tilted, _ = derive_proxy(fake_scan(tilt=25.0), level="hull", clearance_mm=3.0)
    assert abs(float(tilted.bounds[0][2])) < 0.6
    a = np.sort(np.asarray(flat.extents, float))
    b = np.sort(np.asarray(tilted.extents, float))
    assert np.allclose(a, b, atol=2.0), (
        f"tilt not corrected: {np.round(a, 1)} vs {np.round(b, 1)}"
    )


def test_hopeless_scan_degrades_loudly():
    """A scan too broken for its level must still yield usable geometry AND say
    so — a silent downgrade is how a user ends up designing against a lie."""
    proxy, report = derive_proxy(fake_scan(shred=0.35, noise=1.2),
                                 level="offset", clearance_mm=3.0)
    assert proxy.is_watertight, "degradation must still produce a closed solid"
    assert report["warnings"], "degraded silently"
    if report["level"] != "offset":
        assert any("degrad" in w or "hull" in w or "closed" in w
                   for w in report["warnings"]), report["warnings"]


# ---- scan fit ----------------------------------------------------------------
FLOOR = 4.0
FIT_SPEC = {"id": "obj", "clearanceMm": 3.0, "removalAxis": "+z",
            "placementMm": [0, 0, FLOOR]}
# Built the same way a real proxy is -- marching cubes over an occupancy grid,
# not a trimesh primitive. Beyond fidelity this matters for speed: trimesh's
# voxelizer is pathological on the sliver fan-caps of `creation.cylinder`
# (measured 27s vs 0.25s for marching-cubes geometry of the same size), and a
# fixture that slow would price these checks out of CI for no real reason.
FIT_PROXY = solid_from(tube(20, 40), (-26, -26, -6), (26, 26, 46))


def _verdicts(part):
    return tuple(r["ok"] for r in
                 check_scan_fit(part, FIT_PROXY, FIT_SPEC)["results"])


def good_cup():
    """Straight-walled cup with a floor and headroom -- the correct design."""
    return carve(block(60, 60, 54), tube(23, 50, z=FLOOR))


def test_scan_fit_passes_a_good_cup():
    assert _verdicts(good_cup()) == (True, True, True)


def test_scan_fit_passes_a_partial_tray():
    """A tray cupping only the bottom of the object is a legitimate design and
    must not be failed for the parts of the object it never touches."""
    part = carve(block(60, 60, 18), tube(23, 14, z=FLOOR))
    contain, retain, _ = _verdicts(part)
    assert contain is True and retain is True


def test_scan_fit_catches_a_collision():
    part = carve(block(60, 60, 54), tube(15, 50, z=FLOOR))
    assert _verdicts(part)[0] is False, "cavity narrower than the object passed"


def test_scan_fit_catches_a_trap():
    """THE check the parametric path never needed: a cavity reached through an
    opening narrower than the object is geometrically perfect and physically
    useless. Containment and retention both pass; only extraction catches it."""
    part = carve(block(60, 60, 64),
                 tube(23, 44, z=FLOOR), tube(8, 16, z=FLOOR + 44))
    contain, retain, extract = _verdicts(part)
    assert contain is True, "trap fixture should not collide"
    assert retain is True, "trap fixture should be walled"
    assert extract is False, "the object is trapped and extraction missed it"


def test_scan_fit_catches_a_part_that_holds_nothing():
    """A flat plate the object merely rests on must fail retention."""
    plate = solid_from(block(60, 60, 4, z=-4), (-34, -34, -10), (34, 34, 6))
    assert _verdicts(plate)[1] is False


def test_scan_fit_refuses_an_open_enclosure():
    """Occupancy classification needs a closed surface; say so rather than
    grading noise."""
    open_part = trimesh.intersections.slice_mesh_plane(
        good_cup(), [0, 0, 1], [0, 0, 10], cap=False
    )
    out = check_scan_fit(open_part, FIT_PROXY, FIT_SPEC)
    assert out.get("error"), "an open enclosure was graded instead of refused"
    assert not out["results"]


def test_scan_fit_placement_is_honoured():
    """Grading the UNPLACED proxy reads the cavity floor as a collision. The
    spec's placement must move it where the design put it."""
    part = good_cup()
    placed = check_scan_fit(part, FIT_PROXY, FIT_SPEC)["results"][0]["ok"]
    unplaced = check_scan_fit(
        part, FIT_PROXY, dict(FIT_SPEC, placementMm=[0, 0, 0])
    )["results"][0]["ok"]
    assert placed is True and unplaced is False, (
        f"placement had no effect (placed={placed}, unplaced={unplaced})"
    )



# ---- HTTP seam ---------------------------------------------------------------
def test_run_endpoint_scan_round_trip():
    """Drive the whole seam: upload a defective scan to /run, let the sidecar
    derive the proxy and bind it, have mesh-engine code build a cradle around
    it, and get scanFit verdicts back.

    Uses engine="mesh" so this needs no CAD kernel — the plumbing under test
    (decode -> proxy -> namespace -> checks) is kernel-independent."""
    import base64

    import app as app_module
    from fastapi.testclient import TestClient

    scan_b64 = base64.b64encode(
        fake_scan().export(file_type="ply")
    ).decode()

    # Mesh-engine code: carve the proxy (plus a lift-out column) from a block,
    # the same occupancy route `solid_from` uses, so no boolean engine and no
    # kernel are involved.
    code = """
import numpy as np, trimesh
from scipy import ndimage
from skimage import measure as sk_measure

FLOOR, WALL, PITCH = 3.0, 5.0, 1.2
lo = scan.bounds[0] - [WALL, WALL, FLOOR]
hi = scan.bounds[1] + [WALL, WALL, 12.0]
axes = [np.arange(lo[i], hi[i] + PITCH, PITCH) for i in range(3)]
X, Y, Z = np.meshgrid(*axes, indexing="ij")

vg = scan.voxelized(PITCH)
sm = np.asarray(vg.matrix, bool)
so = np.asarray(vg.transform, float)[:3, 3]
idx = np.stack([
    np.rint((g - so[i]) / PITCH).astype(int) for i, g in enumerate((X, Y, Z))
], axis=-1)
ok = np.all((idx >= 0) & (idx < np.asarray(sm.shape)), axis=-1)
cav = np.zeros(X.shape, bool)
ii = idx[ok]
cav[ok] = sm[ii[:, 0], ii[:, 1], ii[:, 2]]
# Fill the proxy solid, widen it by one voxel, then sweep it up so the object
# can be lifted out. The dilation matters: this grid is coarser than the one
# the verifier uses, and without it the carve lands ~half a voxel tight and
# reads as a collision. Carving a margin beyond the proxy is what generated
# code should do for exactly this reason.
cav = ndimage.binary_fill_holes(cav)
cav = ndimage.binary_dilation(cav)
cav = np.maximum.accumulate(cav, axis=2)

solid = (Z >= lo[2]) & ~cav
occ = np.pad(solid, 2)
field = (ndimage.distance_transform_edt(~occ)
         - ndimage.distance_transform_edt(occ)).astype(np.float32)
v, f, _, _ = sk_measure.marching_cubes(field, level=0.0)
result = trimesh.Trimesh(vertices=lo - 2 * PITCH + v * PITCH, faces=f)
result.merge_vertices()
if float(result.volume) < 0:
    result.invert()
"""
    client = TestClient(app_module.app)
    r = client.post("/run", json={
        "code": code,
        "formats": ["stl"],
        "engine": "mesh",
        "allowRemesh": True,
        "meshes": {"scan": {"b64": scan_b64, "fileType": "ply",
                            "proxyLevel": "hull", "clearanceMm": 3.0}},
        "checks": {"scanFit": {"scan": "scan", "id": "obj",
                               "clearanceMm": 3.0, "removalAxis": "+z"}},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok"), body.get("error")

    report = (body.get("scans") or {}).get("scan")
    assert report, f"no scan report returned: {list(body)}"
    assert not report.get("error"), report["error"]
    assert report["watertight"] is True
    assert report["level"] in ("bbox", "hull", "offset")

    scan_fit = (body.get("checks") or {}).get("scanFit")
    assert scan_fit, f"no scanFit verdicts: {body.get('checks')}"
    assert not scan_fit.get("error"), scan_fit["error"]
    kinds = {x["kind"]: x["ok"] for x in scan_fit["results"]}
    assert set(kinds) == {"scan_containment", "scan_retention", "scan_extraction"}
    assert kinds["scan_containment"] is True, scan_fit["results"]
    assert kinds["scan_retention"] is True, scan_fit["results"]


def test_run_endpoint_reports_an_unreadable_scan():
    """A scan we cannot decode must come back as a NAMED error the user can
    act on, not a bare failed run."""
    import app as app_module
    from fastapi.testclient import TestClient

    client = TestClient(app_module.app)
    r = client.post("/run", json={
        "code": "result = None",
        "formats": ["stl"],
        "engine": "mesh",
        "meshes": {"scan": {"b64": "bm90IGEgbWVzaA==", "fileType": "xyz"}},
    })
    assert r.status_code == 200, r.text
    report = (r.json().get("scans") or {}).get("scan")
    assert report and report.get("error"), r.json()
    assert "unsupported scan format" in report["error"]


TESTS = [
    test_every_level_closes_a_defective_scan,
    test_proxy_rests_on_z0,
    test_proxy_is_conservative,
    test_offset_follows_the_concavity_hull_bridges,
    test_clearance_grows_the_proxy,
    test_debris_is_dropped,
    test_tilted_capture_is_grounded,
    test_hopeless_scan_degrades_loudly,
    test_scan_fit_passes_a_good_cup,
    test_scan_fit_passes_a_partial_tray,
    test_scan_fit_catches_a_collision,
    test_scan_fit_catches_a_trap,
    test_scan_fit_catches_a_part_that_holds_nothing,
    test_scan_fit_refuses_an_open_enclosure,
    test_scan_fit_placement_is_honoured,
    test_run_endpoint_scan_round_trip,
    test_run_endpoint_reports_an_unreadable_scan,
]


def main():
    failures = 0
    for t in TESTS:
        t0 = time.time()
        try:
            t()
            print(f"PASS {t.__name__} ({time.time() - t0:.1f}s)")
        except Exception:  # noqa: BLE001
            failures += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    if failures:
        print(f"\n{failures}/{len(TESTS)} FAILED")
        sys.exit(1)
    print(f"\nall {len(TESTS)} passed")


if __name__ == "__main__":
    main()
