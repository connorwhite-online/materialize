"""
Plain-python test runner for sdf_kit v2 + networks + fea (no pytest — the
sidecar image stays lean). Run: `python3 cad-runner/tests/run_tests.py`.
Covers the MTR-177 / MTR-179 contracts: TPMS thickness means real mm, the
dual-network verifier catches both isolation and leaks, from_mesh bridges
B-rep meshes into the SDF world, to_mesh refuses oversized grids helpfully,
and fea_probe localizes a cantilever's root as the hotspot.
"""
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import trimesh
import trimesh.sample

from sdf_kit import (
    box, capsule, from_mesh, gyroid, mask, offset_field, shell_field, smin,
    sphere, to_mesh, translate, union,
)
from networks import check_networks
from fea import fea_probe

THICKNESS_MEASUREMENT = {}


# ---- helpers -----------------------------------------------------------------
def first_hit_distances(mesh, origins, dirs):
    """Moller-Trumbore first-hit distance per ray (pure numpy — the container
    has no rtree, so trimesh's ray casting is unavailable)."""
    tri = mesh.triangles
    v0, v1, v2 = tri[:, 0], tri[:, 1], tri[:, 2]
    e1, e2 = v1 - v0, v2 - v0
    out = []
    for o, d in zip(origins, dirs):
        p = np.cross(d, e2)
        det = np.einsum("ij,ij->i", e1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        tvec = o - v0
        u = np.einsum("ij,ij->i", tvec, p) * inv
        q = np.cross(tvec, e1)
        v = np.einsum("j,ij->i", d, q) * inv
        t = np.einsum("ij,ij->i", e2, q) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
        out.append(t[hit].min() if hit.any() else np.nan)
    return np.asarray(out)


def jacketed_gyroid_field(P):
    """30mm cube: gyroid sheet core (cell 10, t 1.2) sealed inside a 2mm-wall
    jacket — the heat-exchanger-core shape. Two fully enclosed void networks."""
    b = box(P, (15, 15, 15), (15, 15, 15))
    jacket = shell_field(b, 2.0)
    core = mask(gyroid(P, 10.0, 1.2), offset_field(b, -1.0))
    return union(jacket, core)


def pick_ports():
    """Derive port positions from the analytic field sign: sample the interior
    and keep points deep inside each network (normalized field > +2mm /
    < -2mm clearance), so ports never straddle the sheet."""
    ax = np.arange(7.0, 23.5, 1.0)
    X, Y, Z = np.meshgrid(ax, ax, ax, indexing="ij")
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    d = gyroid(pts, 10.0, 0.0, solid=True)  # t=0 solid form = normalized field
    plus, minus = pts[d > 2.0], pts[d < -2.0]
    assert len(plus) > 1 and len(minus) > 1, "field sampling found no deep voids"

    def pair(cands):
        far = np.argmax(np.linalg.norm(cands - cands[0], axis=1))
        return cands[0], cands[far]

    (a_in, a_out), (b_in, b_out) = pair(plus), pair(minus)
    return [
        {"name": "a_in", "point": a_in.tolist(), "r": 1.2},
        {"name": "a_out", "point": a_out.tolist(), "r": 1.2},
        {"name": "b_in", "point": b_in.tolist(), "r": 1.2},
        {"name": "b_out", "point": b_out.tolist(), "r": 1.2},
    ]


# ---- tests ---------------------------------------------------------------
def test_gyroid_thickness_is_real_mm():
    """Sheet thickness parameter must mean physical mm within 15%, measured on
    the actual meshed geometry by casting rays through the wall."""
    def sheet(Q):
        return mask(gyroid(Q, 10.0, 1.2), box(Q, (15, 15, 15), (6, 6, 6)))

    m = to_mesh(sheet, (8, 8, 8), (22, 22, 22), pitch=0.25)
    assert m.is_watertight, "measurement sheet not watertight"
    pts, fid = trimesh.sample.sample_surface(m, 200, seed=0)
    dirs = -m.face_normals[fid]
    dists = first_hit_distances(m, pts + dirs * 1e-3, dirs) + 1e-3
    measured = float(np.median(dists[np.isfinite(dists)]))
    THICKNESS_MEASUREMENT["target"] = 1.2
    THICKNESS_MEASUREMENT["measured"] = measured
    err = abs(measured - 1.2) / 1.2
    THICKNESS_MEASUREMENT["error"] = err
    assert err < 0.15, f"sheet thickness {measured:.3f}mm vs 1.2mm ({err:.0%} off)"


def test_gyroid_two_isolated_networks():
    """The flagship invariant: a sealed gyroid-sheet core has exactly two void
    networks, each owning its declared port pair, with a real wall between."""
    m = to_mesh(jacketed_gyroid_field, (-2, -2, -2), (32, 32, 32), pitch=0.4)
    assert m.is_watertight, "jacketed gyroid mesh not watertight"

    report = check_networks(m, pick_ports())
    assert report["isolated"] is True, f"expected isolation, got {report}"
    assert report["components"] == 2, f"expected 2 networks, got {report}"
    ports = report["ports"]
    assert ports["a_in"] == ports["a_out"], f"circuit a split: {ports}"
    assert ports["b_in"] == ports["b_out"], f"circuit b split: {ports}"
    assert ports["a_in"] != ports["b_in"], f"circuits share a void: {ports}"
    mw = report["minWallVoxels"]
    assert mw is not None and 1 <= mw <= 8, \
        f"minWallVoxels {mw} implausible for a 1.2mm sheet at pitch {report['pitch']:.3f}"


def test_from_mesh_matches_analytic_box():
    """The B-rep bridge: from_mesh of a box must reproduce the analytic box
    SDF within ~pitch at sampled points."""
    pitch = 1.0
    bmesh = trimesh.creation.box(extents=(20, 16, 12))
    f = from_mesh(bmesh, pitch=pitch)
    rng = np.random.default_rng(7)
    P = rng.uniform(-1, 1, size=(500, 3)) * np.array([12.0, 10.0, 8.0])
    got = f(P)
    want = box(P, (0, 0, 0), (10, 8, 6))
    worst = float(np.max(np.abs(got - want)))
    assert worst <= 1.2 * pitch, f"from_mesh error {worst:.2f}mm > ~pitch ({pitch}mm)"
    # signs must never disagree beyond the surface band
    off = np.abs(want) > pitch
    assert np.all(np.sign(got[off]) == np.sign(want[off])), "inside/outside flipped"


def test_from_mesh_blends_watertight():
    """A from_mesh box smin-blended with a capsule must mesh watertight — the
    whole point of the bridge is composing B-rep bodies into implicit ones."""
    f = from_mesh(trimesh.creation.box(extents=(20, 16, 12)), pitch=1.0)

    def blended(P):
        return smin(f(P), capsule(P, (8, 0, 0), (20, 0, 0), 4.0), 3.0)

    m = to_mesh(blended, (-14, -12, -10), (26, 12, 10), pitch=0.5)
    assert m.is_watertight, "blended from_mesh body not watertight"
    assert m.volume > 20 * 16 * 12 * 0.8, "blend lost the box body"


def test_to_mesh_budget_names_a_pitch():
    """Oversized grids must be refused before allocation, with an error naming
    a pitch that fits — a failure the repair loop can act on."""
    try:
        to_mesh(lambda P: sphere(P, (0, 0, 0), 10), (0, 0, 0), (400, 400, 400), pitch=0.2)
    except ValueError as e:
        msg = str(e)
        assert "pitch >=" in msg, f"error does not name a pitch: {msg}"
        suggested = float(msg.rsplit("pitch >=", 1)[1].strip())
        n = [int(np.ceil(400 / suggested)) + 1 for _ in range(3)]
        assert n[0] * n[1] * n[2] <= 8_000_000, \
            f"suggested pitch {suggested} still busts the budget"
        return
    raise AssertionError("to_mesh accepted an 8e9-cell grid")


def test_check_networks_negative_single_cavity():
    """A single open cavity with two differently-prefixed ports is NOT
    isolated — both circuits share one void."""
    def hollow(P):
        return shell_field(box(P, (0, 0, 0), (10, 10, 10)), 2.0)

    m = to_mesh(hollow, (-13, -13, -13), (13, 13, 13), pitch=0.4)
    assert m.is_watertight
    report = check_networks(m, [
        {"name": "a_in", "point": [-5, 0, 0], "r": 2.0},
        {"name": "b_in", "point": [5, 0, 0], "r": 2.0},
    ])
    assert report["components"] == 1, f"expected one shared void, got {report}"
    assert report["ports"]["a_in"] == report["ports"]["b_in"], f"bad mapping: {report}"
    assert report["isolated"] is False, f"leak not flagged: {report}"


def _beam(length):
    move = trimesh.transformations.translation_matrix([length / 2, 4, 4])
    return trimesh.creation.box(extents=(length, 8, 8), transform=move)


def test_fea_cantilever():
    """Cantilever sanity: fixed root, tip load down — hotspot at the root
    third, nonzero deflection, and a longer beam deflects more."""
    supports = [{"point": [0, 4, 4], "r": 6.0}]
    t0 = time.time()
    r40 = fea_probe(_beam(40), [{"point": [40, 4, 4], "r": 3.0, "force": [0, 0, -1.0]}],
                    supports, resolution=32)
    elapsed = time.time() - t0
    assert r40["ok"], f"fea_probe failed: {r40['error']}"
    assert r40["maxDisplacement"] > 0, "beam did not deflect"
    assert r40["hotspots"], "no hotspots returned"
    hot_x = r40["hotspots"][0]["point"][0]
    assert hot_x < 15.0, f"top hotspot at x={hot_x:.1f}, expected in the root third"
    assert elapsed < 10.0, f"resolution-32 probe took {elapsed:.1f}s (budget ~10s)"

    r60 = fea_probe(_beam(60), [{"point": [60, 4, 4], "r": 3.0, "force": [0, 0, -1.0]}],
                    supports, resolution=32)
    assert r60["ok"], f"60mm probe failed: {r60['error']}"
    assert r60["maxDisplacement"] > r40["maxDisplacement"], (
        f"longer beam must deflect more: 60mm={r60['maxDisplacement']:.4g} "
        f"vs 40mm={r40['maxDisplacement']:.4g}")
    print(f"    [fea] 40mm: disp={r40['maxDisplacement']:.4g} "
          f"compliance={r40['compliance']:.4g} hotspot x={hot_x:.1f} ({elapsed:.1f}s); "
          f"60mm disp={r60['maxDisplacement']:.4g}")


def test_fea_refusals():
    """Guards: missing supports and disconnected loads refuse cleanly."""
    beam = _beam(40)
    r = fea_probe(beam, [{"point": [40, 4, 4], "r": 3.0, "force": [0, 0, -1.0]}],
                  [{"point": [500, 500, 500], "r": 1.0}], resolution=32)
    assert not r["ok"] and r["error"], "missing supports must refuse"
    r = fea_probe(beam, [{"point": [500, 500, 500], "r": 1.0, "force": [0, 0, -1.0]}],
                  [{"point": [0, 4, 4], "r": 6.0}], resolution=32)
    assert not r["ok"] and r["error"], "disconnected load must refuse"


def test_transforms_move_primitives():
    """translate/rotate_z warp P, so the primitive lands where advertised."""
    P = np.array([[10.0, 0.0, 0.0], [0.0, 0.0, 0.0]])
    d = sphere(translate(P, (10, 0, 0)), (0, 0, 0), 2.0)
    assert d[0] < 0 < d[1], "translate did not move the sphere to x=+10"
    from sdf_kit import rotate_z
    Q = np.array([[0.0, 10.0, 0.0]])
    d = sphere(rotate_z(Q, 90.0), (10, 0, 0), 2.0)
    assert d[0] < 0, "rotate_z(90) did not carry (10,0,0) onto (0,10,0)"


def test_split_shell_printed_fit():
    from sdf_kit import box, smin, offset_field, subtract, split_shell, to_mesh
    import numpy as np

    def cavity(P):
        return smin(box(P, (0, 0, 8.0), (31, 21, 6)),
                    box(P, (0, 0, 20.5), (25, 15, 6.5)), 14.0)

    def body(P):
        return np.maximum(subtract(offset_field(cavity(P), 2.4), cavity(P)),
                          -P[:, 2])

    fit_gap = 0.25
    bottom, top = split_shell(body, cavity, 16.0, fit_gap=fit_gap)
    mb = to_mesh(bottom, (-40, -30, -3), (40, 30, 34), pitch=0.55)
    mt = to_mesh(top, (-40, -30, -3), (40, 30, 34), pitch=0.55)
    assert mb.is_watertight and mt.is_watertight
    # printed-fit clearance on the lip faces + no interpenetration anywhere
    rng = np.random.default_rng(3)
    pts = rng.uniform([-38, -28, 16.4], [38, 28, 18.6], (40000, 3))
    c = cavity(pts)
    lip_pts = pts[np.abs(c - 1.1) < 0.08][:800]
    gap = top(lip_pts)
    assert np.median(gap) > fit_gap * 0.8, f"median lip clearance {np.median(gap):.2f}"
    both = (bottom(pts) < 0) & (top(pts) < 0)
    assert both.sum() == 0, "halves interpenetrate"
    # union coverage: every solidly-interior body point belongs to one half,
    # EXCEPT inside the designed lip-clearance band (the fit_gap ring between
    # lip and recess is in neither half — that gap IS the printed fit).
    z_split, lip_h, lip_t = 16.0, 3.0, 1.1
    vol = rng.uniform([-38, -28, -1], [38, 28, 33], (60000, 3))
    interior = body(vol) < -0.2
    p_in = vol[interior]
    covered = (bottom(p_in) < 0) | (top(p_in) < 0)
    missed = p_in[~covered]
    assert len(missed) < 0.05 * len(p_in), f"{len(missed)}/{len(p_in)} interior points uncovered"
    if len(missed):
        cz = missed[:, 2]
        cc = cavity(missed)
        in_band = (
            (cz > z_split - 1.2) & (cz < z_split + lip_h + fit_gap + 0.2)
            & (cc > -0.1) & (cc < lip_t + fit_gap + 0.1)
        )
        assert in_band.all(), "uncovered material outside the lip-clearance band"


TESTS = [
    test_gyroid_thickness_is_real_mm,
    test_gyroid_two_isolated_networks,
    test_from_mesh_matches_analytic_box,
    test_from_mesh_blends_watertight,
    test_to_mesh_budget_names_a_pitch,
    test_check_networks_negative_single_cavity,
    test_fea_cantilever,
    test_fea_refusals,
    test_transforms_move_primitives,
    test_split_shell_printed_fit,
]


def main():
    failures = 0
    for t in TESTS:
        start = time.time()
        try:
            t()
            print(f"PASS  {t.__name__}  ({time.time() - start:.1f}s)")
        except Exception:
            failures += 1
            print(f"FAIL  {t.__name__}")
            traceback.print_exc()
    if THICKNESS_MEASUREMENT:
        print(f"\ngyroid sheet thickness: target {THICKNESS_MEASUREMENT['target']}mm, "
              f"measured {THICKNESS_MEASUREMENT['measured']:.3f}mm "
              f"({THICKNESS_MEASUREMENT['error']:.1%} error)")
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} tests passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
