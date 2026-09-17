"""
Plain-python tests for the exact-feature boolean vocabulary (sdf_kit v4:
mesh_cyl / mesh_box / mesh_subtract / mesh_union / mesh_intersect).

The contract these pin is narrow and specific. It is NOT "the mesh path is
inaccurate" — a field-level subtract sizes a bore to within ~0.01mm across
every usable pitch, comfortably inside print tolerance. It is that marching
cubes cannot represent a CREASE, so a field subtract rounds a bore mouth into
a chamfer and leaves a nominally flat face measurably wavy. Booleaning the
exact primitive into the already-meshed body fixes exactly that, and these
tests hold both halves of the claim so neither can quietly regress.

Run: `python3 cad-runner/tests/test_mesh_boolean.py`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import trimesh  # noqa: E402

from sdf_kit import (  # noqa: E402
    box, mesh_box, mesh_cyl, mesh_intersect, mesh_subtract, mesh_union,
    smin, sphere, subtract, to_mesh,
)

R, TOP, PITCH = 2.5, 5.0, 0.8
LO, HI = (-17, -17, -7), (17, 17, 7)


def _plate(P):
    return box(P, (0, 0, 0), (15, 15, TOP))


def _bore_radius_at(mesh, z, tol=0.15):
    v = np.asarray(mesh.vertices)
    sel = v[np.abs(v[:, 2] - z) < tol]
    r = np.hypot(sel[:, 0], sel[:, 1])
    r = r[r < R * 2]
    return float(r.min()) if len(r) else float("nan")


def test_field_subtract_sizes_the_bore_correctly():
    """The honest baseline: away from edges, a field subtract is ACCURATE.
    If this ever starts failing, the case for the mesh path has changed and
    the docs above it need rewriting, not the threshold here."""
    for pitch in (0.4, 0.8, 1.2):
        mesh = to_mesh(
            lambda P: subtract(_plate(P), _cyl_field(P)), LO, HI, pitch=pitch
        )
        r = _bore_radius_at(mesh, 0.0)
        assert abs(r - R) < 0.05, f"pitch {pitch}: bore r={r}, want ~{R}"


def _cyl_field(P):
    from sdf_kit import cyl_z

    return cyl_z(P, 0, 0, R, -20, 20)


def test_mesh_boolean_keeps_the_bore_mouth_sharp():
    """The actual difference: at the rim, a field subtract rounds the mouth
    into a chamfer. 0.29mm of rounding is a press fit gone."""
    field_cut = to_mesh(lambda P: subtract(_plate(P), _cyl_field(P)), LO, HI, pitch=PITCH)
    mesh_cut = mesh_subtract(
        to_mesh(_plate, LO, HI, pitch=PITCH), mesh_cyl(0, 0, R, -20, 20)
    )
    field_r = _bore_radius_at(field_cut, TOP)
    mesh_r = _bore_radius_at(mesh_cut, TOP)
    assert field_r > R + 0.15, f"expected the field cut to round the rim, got {field_r}"
    assert abs(mesh_r - R) < 0.01, f"mesh boolean must hold the rim at {R}, got {mesh_r}"


def test_mesh_boolean_keeps_a_flat_face_planar():
    field_cut = to_mesh(lambda P: subtract(_plate(P), _cyl_field(P)), LO, HI, pitch=PITCH)
    mesh_cut = mesh_subtract(
        to_mesh(_plate, LO, HI, pitch=PITCH), mesh_cyl(0, 0, R, -20, 20)
    )

    def planarity(mesh):
        v = np.asarray(mesh.vertices)
        top = v[v[:, 2] > TOP - 0.05]
        return float(np.abs(top[:, 2] - TOP).max()) if len(top) else float("nan")

    assert planarity(field_cut) > 0.005, "field cut should be measurably wavy"
    assert planarity(mesh_cut) < 1e-6, f"mesh cut must be planar, got {planarity(mesh_cut)}"


def test_boolean_output_is_watertight_and_right_genus():
    """Guaranteed manifoldness is the other half of the case — a through-bore
    is genus 1, and the result must be a closed surface."""
    cut = mesh_subtract(to_mesh(_plate, LO, HI, pitch=PITCH), mesh_cyl(0, 0, R, -20, 20))
    assert cut.is_watertight, "manifold3d booleans must produce closed surfaces"
    assert cut.euler_number == 0, f"one through-hole is genus 1 (euler 0), got {cut.euler_number}"


def test_union_and_intersect_do_what_they_say():
    # half-extents 10 => each box is 20mm on a side (8000mm^3), offset by 10
    # in x. Union spans x -10..20 (30*20*20); the overlap spans x 0..10.
    a = mesh_box((0, 0, 0), (10, 10, 10))
    b = mesh_box((10, 0, 0), (10, 10, 10))
    union = mesh_union(a, b).volume
    inter = mesh_intersect(a, b).volume
    assert abs(union - 12000.0) < 1.0, f"union {union}, want 12000"
    assert abs(inter - 4000.0) < 1.0, f"intersect {inter}, want 4000"
    assert abs((8000 + 8000 - inter) - union) < 1.0, "inclusion-exclusion must hold"


def test_mesh_primitives_mirror_their_field_twins():
    """mesh_cyl/mesh_box take the SAME arguments as cyl_z/box, so swapping is
    a one-word edit. Pinned because that symmetry is the whole vocabulary."""
    c = mesh_cyl(3, -4, 2.0, 1.0, 6.0)
    assert np.allclose(c.bounds[0], [1.0, -6.0, 1.0], atol=0.02), c.bounds
    assert np.allclose(c.bounds[1], [5.0, -2.0, 6.0], atol=0.02), c.bounds
    b = mesh_box((1, 2, 3), (4, 5, 6))
    assert np.allclose(b.bounds[0], [-3, -3, -3]) and np.allclose(b.bounds[1], [5, 7, 9])


def test_empty_result_explains_itself():
    """A disjoint subtract is a modelling mistake the repair loop must be able
    to act on, so it names the likely cause instead of returning empty."""
    a = mesh_box((0, 0, 0), (5, 5, 5))
    try:
        mesh_intersect(a, mesh_box((100, 0, 0), (5, 5, 5)))
    except ValueError as err:
        assert "empty solid" in str(err), err
    else:
        raise AssertionError("a disjoint intersect must raise, not return empty")


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except Exception as err:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {fn.__name__}: {err}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run())
