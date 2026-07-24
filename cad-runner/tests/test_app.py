"""
Plain-python test runner for the sidecar HTTP layer (no pytest — the image
stays lean). Run: `python3 cad-runner/tests/test_app.py`.

Covers the MTR-175/176/177/179/180 HTTP contracts with engine="mesh" scripts
only — this env has numpy/scipy/trimesh but no CAD kernel (build123d/OCP), so
the B-rep and topo paths are exercised only in the container image. Session
protocol is pinned by lib/cad/session-client.ts.
"""
import os
import sys
import time
import traceback
from pathlib import Path

# Must be set before importing app (it fails closed without a secret), and
# stays inherited by every spawned child.
os.environ["CAD_RUNNER_ALLOW_NO_AUTH"] = "true"
if __name__ == "__main__":
    # Clean inherited shell state in the parent test process ONLY. Spawned
    # children re-import this module as __mp_main__, and popping here would
    # clobber env a test deliberately set (e.g. the voxel kill switch).
    os.environ.pop("CAD_RUNNER_SECRET", None)
    os.environ.pop("CAD_VOXEL_FALLBACK", None)  # default-on kill switch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app_module.app)

# The opposed-iso coverage guarantee (MTR-199): threeQuarterBack is the second,
# opposed isometric — the pair guarantees every face lands in at least one view,
# so rear / left / bottom features are covered by default. Section is added
# ONLY for hollow parts (see test_run_hollow_part_gets_section), so it is not
# in this always-present set.
VIEWS = ("threeQuarter", "threeQuarterBack", "top", "front", "side")

# A solid box fills its bounding box (fill ratio 1.0) -> no section view.
SOLID_BOX_SCRIPT = """
import trimesh
result = trimesh.creation.box(extents=(20, 20, 20))
"""

# A torus is watertight but mostly empty bounding box (fill ratio ~0.44 < the
# 0.75 hollow threshold) -> the packet must include a section cutaway so the
# judge / self-review can see the interior (MTR-199).
HOLLOW_TORUS_SCRIPT = """
import trimesh
result = trimesh.creation.torus(major_radius=10.0, minor_radius=3.0)
"""

SPHERE_SCRIPT = """
import trimesh
result = trimesh.creation.icosphere(subdivisions=2, radius=10)
"""

# Icosphere with a large polar cap removed: a many-vertex boundary loop that
# trimesh's fan fill_holes cannot close, so the repair pipeline genuinely
# fails and the allowRemesh decision is what stands between fail and pass.
OPEN_MESH_SCRIPT = """
import trimesh
m = trimesh.creation.icosphere(subdivisions=3, radius=10)
m.update_faces(m.triangles_center[:, 2] < 8.0)
m.remove_unreferenced_vertices()
result = m
"""

# sdf_kit two-cavity block: 28x12x12 box with two sealed 8x6x6 voids and a
# 6mm wall between them — two isolated networks by construction.
TWO_CAVITY_SCRIPT = """
from sdf_kit import box, subtract, to_mesh

def solid(P):
    outer = box(P, (0, 0, 0), (14, 6, 6))
    a = box(P, (-7, 0, 0), (4, 3, 3))
    b = box(P, (7, 0, 0), (4, 3, 3))
    return subtract(subtract(outer, a), b)

result = to_mesh(solid, (-16, -8, -8), (16, 8, 8), pitch=0.5)
"""

# Cantilever box for the fea check (mirrors run_tests.py's beam).
FEA_BOX_SCRIPT = """
import trimesh
result = trimesh.creation.box(extents=(40, 8, 8)).apply_translation((20, 4, 4))
"""

# MTR-213: a base + lid returned as ONE `result` compound (two disjoint,
# comparable, watertight bodies). The old fragment gate hard-failed this and the
# repair loop collapsed it to a single shell; now it is promoted to a base/lid
# assembly.
PROMOTE_COMPOUND_SCRIPT = """
import trimesh
base = trimesh.creation.box(extents=(40, 30, 16)).apply_translation((0, 0, 8))
lid = trimesh.creation.box(extents=(40, 30, 8)).apply_translation((0, 0, 22))
result = trimesh.util.concatenate([base, lid])
"""

# One real solid trailing a small loose chip — genuine debris, NOT an assembly.
# Must still fail the fragment gate (promotion is conservative by design).
DEBRIS_SCRIPT = """
import trimesh
solid = trimesh.creation.box(extents=(40, 30, 20))
chip = trimesh.creation.box(extents=(5, 5, 5)).apply_translation((80, 80, 80))
result = trimesh.util.concatenate([solid, chip])
"""

# Model assigned BOTH a compound `result` and a correct `parts` dict — `parts`
# must win (taking `result` first discarded the split and left a stacked compound).
PARTS_AND_RESULT_SCRIPT = """
import trimesh
base = trimesh.creation.box(extents=(40, 30, 16)).apply_translation((0, 0, 8))
lid = trimesh.creation.box(extents=(40, 30, 8)).apply_translation((0, 0, 22))
result = trimesh.util.concatenate([base, lid])
parts = {"housing": base, "cover": lid}
"""

# Thin lid (~6% of base volume) — must promote under the relaxed volume gate.
THIN_LID_SCRIPT = """
import trimesh
base = trimesh.creation.box(extents=(40, 30, 20)).apply_translation((0, 0, 10))
lid = trimesh.creation.box(extents=(40, 30, 1.2)).apply_translation((0, 0, 21))
result = trimesh.util.concatenate([base, lid])
"""


# Complete dual-fluid exchanger via the composed generator: the script only
# assigns fluid_ports/fluid_plugs and the sidecar auto-verifies isolation.
EXCHANGER_SCRIPT = """
from sdf_kit import to_mesh
from exchanger import exchanger_core
field, ports, plugs, bounds = exchanger_core((20, 20, 20), cell=8.0, wall=1.2)
result = to_mesh(field, *bounds, pitch=0.4)
fluid_ports = ports
fluid_plugs = plugs
"""

# Same build, but the declarations use the dict shorthand a model actually
# emitted (name -> point / name -> capsule dict) instead of the canonical
# lists — the sidecar must coerce these, not silently skip the check.
EXCHANGER_DICT_DECL_SCRIPT = """
from sdf_kit import to_mesh
from exchanger import exchanger_core
field, ports, plugs, bounds = exchanger_core((20, 20, 20), cell=8.0, wall=1.2)
result = to_mesh(field, *bounds, pitch=0.4)
fluid_ports = {p["name"]: {"point": p["point"], "r": p["r"]} for p in ports}
fluid_plugs = {f"plug{i}": p for i, p in enumerate(plugs)}
"""

EXCHANGER_BROKEN_DECL_SCRIPT = """
from sdf_kit import to_mesh
from exchanger import exchanger_core
field, ports, plugs, bounds = exchanger_core((20, 20, 20), cell=8.0, wall=1.2)
result = to_mesh(field, *bounds, pitch=0.4)
fluid_ports = {"a_in": "not-a-point", "b_in": None}
fluid_plugs = plugs
"""


def run(code, **extra):
    body = {"code": code, "formats": ["stl"], "engine": "mesh", **extra}
    r = client.post("/run", json=body)
    assert r.status_code == 200, f"/run -> {r.status_code}: {r.text[:300]}"
    return r.json()


def create_session():
    r = client.post("/session", json={"engine": "mesh"})
    assert r.status_code == 200, f"/session -> {r.status_code}: {r.text[:300]}"
    sid = r.json().get("sessionId")
    assert sid, f"no sessionId in {r.json()}"
    return sid


def sess_exec(sid, code, expect_status=200, **extra):
    r = client.post(
        f"/session/{sid}/exec",
        json={"code": code, "formats": ["stl"], "allowRemesh": False, **extra},
    )
    assert r.status_code == expect_status, (
        f"exec -> {r.status_code} (wanted {expect_status}): {r.text[:300]}"
    )
    return r.json() if expect_status == 200 else None


def delete_session(sid):
    r = client.delete(f"/session/{sid}")
    assert r.status_code == 200 and r.json()["ok"] is True, r.text[:200]


# ---- tests ---------------------------------------------------------------
def test_run_mesh_sphere_multiview():
    """A watertight mesh-mode sphere: ok, 4 named renders, and renderPng
    stays the threeQuarter view (docs 07 §A compatibility)."""
    p = run(SPHERE_SCRIPT)
    assert p["ok"] is True, p.get("error")
    assert p["validation"]["compiled"] and p["validation"]["isSolid"]
    assert p["validation"]["isWatertight"] and p["validation"]["isManifold"]
    assert p["files"].get("stl"), "missing stl"
    renders = p.get("renders") or {}
    for view in VIEWS:
        assert renders.get(view), f"missing render {view}"
    assert p["renderPng"] == renders["threeQuarter"], "renderPng != threeQuarter"
    # extra views are the small figsize -> strictly smaller payloads
    assert len(renders["top"]) < len(renders["threeQuarter"]), \
        "expected smaller secondary views"
    assert p["remeshed"] is False


def test_run_opposed_iso_coverage_guarantee():
    """MTR-199: the default packet carries BOTH isometric views (threeQuarter +
    the opposed threeQuarterBack) so every face appears in at least one view.
    The two iso angles must be genuinely opposed, not duplicates."""
    p = run(SPHERE_SCRIPT)
    assert p["ok"] is True, p.get("error")
    renders = p.get("renders") or {}
    assert renders.get("threeQuarter"), "missing front iso"
    assert renders.get("threeQuarterBack"), "missing opposed iso"
    # Opposed azimuths in _VIEW_ANGLES -> the two renders must differ.
    assert renders["threeQuarter"] != renders["threeQuarterBack"], \
        "opposed iso is a duplicate of the front iso"


def test_run_hollow_part_gets_section():
    """MTR-199: a hollow part (fill ratio below the threshold) gets a section
    cutaway added to the packet; a solid part does NOT (a section of a solid is
    misleading, not diagnostic)."""
    hollow = run(HOLLOW_TORUS_SCRIPT)
    assert hollow["ok"] is True, hollow.get("error")
    assert (hollow.get("renders") or {}).get("section"), \
        "hollow part is missing its section cutaway"

    solid = run(SOLID_BOX_SCRIPT)
    assert solid["ok"] is True, solid.get("error")
    assert "section" not in (solid.get("renders") or {}), \
        "a solid box should not get a section view"


def test_run_open_mesh_remesh_is_a_decision():
    """docs 02 §C: an unclosable mesh fails with a substantive diagnosis by
    default; the same script passes remeshed when the caller opts in."""
    p = run(OPEN_MESH_SCRIPT)  # allowRemesh defaults false
    assert p["ok"] is False, "open mesh must not pass without remesh consent"
    assert p["validation"]["isWatertight"] is False
    assert p["remeshed"] is False
    err = p.get("error") or ""
    assert "watertight" in err, f"diagnosis missing: {err!r}"
    assert "euler number" in err, f"no euler diagnosis: {err!r}"
    assert "boundary" in err, f"no broken-face diagnosis: {err!r}"
    assert "allowRemesh" in err, f"no remediation hint: {err!r}"

    p2 = run(OPEN_MESH_SCRIPT, allowRemesh=True)
    assert p2["remeshed"] is True, f"voxel fallback did not run: {p2.get('error')}"
    assert p2["ok"] is True, p2.get("error")
    assert p2["validation"]["isWatertight"] is True


def test_run_voxel_kill_switch_still_global():
    """CAD_VOXEL_FALLBACK=false wins even over allowRemesh=true."""
    os.environ["CAD_VOXEL_FALLBACK"] = "false"
    try:
        p = run(OPEN_MESH_SCRIPT, allowRemesh=True)
        assert p["remeshed"] is False, "kill switch ignored"
        assert p["ok"] is False
    finally:
        os.environ.pop("CAD_VOXEL_FALLBACK", None)


def test_run_checks_networks_two_cavities():
    """MTR-179 over HTTP: the two-cavity block reports two isolated networks,
    each owning its port pair."""
    p = run(TWO_CAVITY_SCRIPT, checks={"networks": {"ports": [
        {"name": "a_in", "point": [-9, 0, 0], "r": 1.5},
        {"name": "a_out", "point": [-5, 0, 0], "r": 1.5},
        {"name": "b_in", "point": [5, 0, 0], "r": 1.5},
        {"name": "b_out", "point": [9, 0, 0], "r": 1.5},
    ]}})
    assert p["ok"] is True, p.get("error")
    net = (p.get("checks") or {}).get("networks")
    assert net, f"no networks check in payload: {list(p)}"
    assert net.get("error") is None, f"networks check errored: {net}"
    assert net["isolated"] is True, f"expected isolation: {net}"
    assert net["components"] == 2, f"expected 2 networks: {net}"
    ports = net["ports"]
    assert ports["a_in"] == ports["a_out"] != ports["b_in"] == ports["b_out"], \
        f"bad port mapping: {ports}"


def test_run_script_declared_fluid_ports():
    """Dual-fluid contract: a script that assigns `fluid_ports` (+ optional
    `fluid_plugs`) gets the networks isolation check automatically — no
    request-side checks needed. exchanger_core hands scripts both lists."""
    p = run(EXCHANGER_SCRIPT)
    assert p["ok"] is True, p.get("error")
    net = (p.get("checks") or {}).get("networks")
    assert net, f"fluid_ports did not trigger a networks check: {list(p)}"
    assert net.get("error") is None, f"networks check errored: {net}"
    assert net["isolated"] is True, f"expected isolation: {net}"
    assert net["components"] == 2, f"expected 2 circuits: {net}"
    assert net["plugs"] == 4, f"expected 4 refilled bores: {net}"


def test_run_fluid_ports_dict_shorthand_coerced():
    """Models emit fluid_ports as dicts (name -> {point, r}); the sidecar
    must coerce that to the canonical list and still run the check — the
    silent isinstance(list) skip once shipped an unverified solid block."""
    p = run(EXCHANGER_DICT_DECL_SCRIPT)
    assert p["ok"] is True, p.get("error")
    net = (p.get("checks") or {}).get("networks")
    assert net, f"dict-form fluid_ports did not trigger the check: {list(p)}"
    assert net.get("error") is None, f"coercion failed: {net}"
    assert net["isolated"] is True, f"expected isolation: {net}"


def test_run_fluid_ports_garbage_is_an_error_not_a_skip():
    """An unparseable fluid_ports declaration must surface as a networks
    ERROR (repair-loop food), never a silent skip and never a vacuous
    zero-port PASS."""
    p = run(EXCHANGER_BROKEN_DECL_SCRIPT)
    net = (p.get("checks") or {}).get("networks")
    assert net, "broken fluid_ports produced no networks entry at all"
    assert net.get("error"), f"expected a declaration error: {net}"
    assert "fluid_ports malformed" in net["error"], net["error"]
    assert net.get("isolated") is None, f"must carry no verdict: {net}"


def test_decimate_stl_to_cap_direct():
    """Oversized-STL handling: a mesh whose binary STL exceeds
    MAX_OUTPUT_BYTES must slim to fit (watertight preserved, reduction +
    method recorded on the entry) instead of shipping nothing — a 150mm-class
    TPMS core measures >200MB raw, and dropping the file voided the build."""
    import trimesh

    sphere = trimesh.creation.icosphere(subdivisions=5, radius=20.0)
    raw_bytes = 84 + 50 * len(sphere.faces)
    saved = app_module.MAX_OUTPUT_BYTES
    app_module.MAX_OUTPUT_BYTES = raw_bytes // 4  # force the over-cap path
    entry = {}
    try:
        slim = app_module._decimate_stl_to_cap(sphere, entry)
    finally:
        app_module.MAX_OUTPUT_BYTES = saved
    assert slim is not None, "slimming returned nothing for a clean sphere"
    assert slim.is_watertight, "slimmed mesh must stay watertight"
    assert 84 + 50 * len(slim.faces) <= raw_bytes // 4, (
        f"slimmed STL still over cap: {len(slim.faces)} faces")
    d = entry.get("decimatedForExport")
    assert d and d["toTriangles"] < d["fromTriangles"], (
        f"reduction not recorded: {entry}")
    assert d["method"] in ("quadric", "voxel"), f"method missing: {d}"


def test_decimate_voxel_fallback_preserves_cavities():
    """When quadric decimation can't stay watertight (dense TPMS meshes do
    this reliably), the voxel-remesh fallback must (a) produce a watertight
    under-cap mesh and (b) keep internal voids VOID — a `.fill()`-style
    remesh would pave an exchanger's channels shut and ship a brick."""
    import numpy as np
    import trimesh

    # Hollow box: 40mm outer shell, 30mm cavity, no openings. Needs enough
    # faces that the face-target -> pitch estimate lands well below the
    # cavity size (a coarse test mesh would voxel-remesh at a pitch bigger
    # than the walls and prove nothing).
    outer = trimesh.creation.box(extents=(40, 40, 40))
    inner = trimesh.creation.box(extents=(30, 30, 30))
    inner.invert()  # cavity = inverted inner shell
    hollow = trimesh.util.concatenate([outer, inner])
    for _ in range(5):
        hollow = hollow.subdivide()  # 24 -> ~24.5k faces
    assert hollow.is_watertight

    raw_bytes = 84 + 50 * len(hollow.faces)
    saved_cap = app_module.MAX_OUTPUT_BYTES
    saved_fn = trimesh.Trimesh.simplify_quadric_decimation

    def _forced_failure(self, **kwargs):
        raise RuntimeError("forced: exercise the voxel fallback")

    trimesh.Trimesh.simplify_quadric_decimation = _forced_failure
    app_module.MAX_OUTPUT_BYTES = raw_bytes // 2
    entry = {}
    try:
        slim = app_module._decimate_stl_to_cap(hollow, entry)
    finally:
        app_module.MAX_OUTPUT_BYTES = saved_cap
        trimesh.Trimesh.simplify_quadric_decimation = saved_fn

    assert slim is not None, "voxel fallback produced nothing"
    assert slim.is_watertight, "voxel fallback must be watertight"
    d = entry.get("decimatedForExport")
    assert d and d["method"] == "voxel", f"expected voxel method: {d}"
    # Cavity preservation: solid volume ≈ shell only (40^3 - 30^3 = 37k),
    # nowhere near the filled 64k. Generous tolerance for pitch quantization.
    vol = abs(float(slim.volume))
    assert vol < 55_000, f"cavity was paved shut: volume {vol:.0f} mm^3"
    assert vol > 20_000, f"shell lost: volume {vol:.0f} mm^3"


def test_run_checks_fea_supported_box():
    """MTR-180 over HTTP: a root-supported cantilever probe returns hotspots
    and nonzero deflection; a bad checks spec degrades to {'error'} not a 500."""
    p = run(FEA_BOX_SCRIPT, checks={"fea": {
        "loads": [{"point": [40, 4, 4], "r": 3.0, "force": [0, 0, -1.0]}],
        "supports": [{"point": [0, 4, 4], "r": 6.0}],
        "resolution": 32,
    }})
    assert p["ok"] is True, p.get("error")
    fea = (p.get("checks") or {}).get("fea")
    assert fea, f"no fea check in payload: {list(p)}"
    assert fea["ok"] is True, f"fea probe failed: {fea.get('error')}"
    assert fea["maxDisplacement"] > 0, f"beam did not deflect: {fea}"
    assert fea["hotspots"], "no hotspots returned"

    # A malformed check never crashes the run (failure isolation).
    p2 = run(FEA_BOX_SCRIPT, checks={"fea": {"loads": "garbage"}})
    assert p2["ok"] is True, "run must survive a broken checks spec"
    assert (p2["checks"]["fea"] or {}).get("error"), \
        f"expected an error-shaped fea check: {p2['checks']}"


def test_run_promotes_two_body_compound_to_assembly():
    """MTR-213: a single `result` compound of two comparable watertight bodies
    round-trips as a base/lid assembly (parts length 2, ordered low->high z),
    not a hard fragment-gate failure."""
    p = run(PROMOTE_COMPOUND_SCRIPT)
    assert p.get("promotedFromSingle") is True, f"compound not promoted: {p.get('error')}"
    parts = p.get("parts")
    assert parts and len(parts) == 2, f"expected 2 promoted parts, got {parts}"
    assert [pt["name"] for pt in parts] == ["base", "lid"], [pt["name"] for pt in parts]
    assert p["ok"] is True, p.get("error")
    for pt in parts:
        assert pt["validation"]["isWatertight"], pt
        assert pt["validation"].get("bodyCount", 1) == 1, pt
    # base (lower body) is the taller 16mm box; lid is the 8mm box.
    assert abs(parts[0]["geometry"]["dimensions"]["z"] - 16.0) < 0.5, parts[0]["geometry"]
    assert abs(parts[1]["geometry"]["dimensions"]["z"] - 8.0) < 0.5, parts[1]["geometry"]


def test_run_debris_still_fails_fragment_gate():
    """MTR-213 guard: a solid trailing a loose chip is genuine debris, not an
    assembly — promotion must NOT fire and the fragment-gate error stands."""
    p = run(DEBRIS_SCRIPT)
    assert p.get("promotedFromSingle") is not True, "debris must not be promoted"
    assert p.get("parts") is None, "debris must not become a parts assembly"
    assert p["ok"] is False, "a solid + loose chip must fail the fragment gate"
    assert "disconnected solids" in (p.get("error") or ""), p.get("error")


def test_run_prefers_parts_dict_over_result_compound():
    """When both `result` and `parts` are assigned, the explicit parts dict
    wins — including the author's names — instead of promoting/failing the
    compound `result`."""
    p = run(PARTS_AND_RESULT_SCRIPT)
    assert p["ok"] is True, p.get("error")
    parts = p.get("parts") or []
    assert [pt["name"] for pt in parts] == ["housing", "cover"], [
        pt["name"] for pt in parts
    ]
    # Came from the explicit dict, not the compound promoter.
    assert p.get("promotedFromSingle") is not True, p


def test_run_promotes_thin_lid_compound():
    """Thin lids below the old 15%-of-max volume gate still promote."""
    p = run(THIN_LID_SCRIPT)
    assert p.get("promotedFromSingle") is True, f"thin lid not promoted: {p.get('error')}"
    parts = p.get("parts") or []
    assert [pt["name"] for pt in parts] == ["base", "lid"], [pt["name"] for pt in parts]
    assert p["ok"] is True, p.get("error")


def test_session_lifecycle():
    """create -> plain exec -> result exec (full payload) -> snapshot ->
    clobber -> rollback -> re-export -> delete. Shapes pinned by
    lib/cad/session-client.ts."""
    sid = create_session()
    try:
        # Plain exec: no result yet -> ok/stdout/namespace triple, no run shape.
        p = sess_exec(sid, "x = 5\nprint('hello', x)\n")
        assert p["ok"] is True, p
        assert "hello 5" in p["stdout"], f"stdout lost: {p['stdout']!r}"
        assert "x" in p["namespace"], p["namespace"]
        assert "validation" not in p, "plain exec must not carry a run payload"

        # State persists across execs; assigning `result` -> full /run payload.
        p = sess_exec(
            sid,
            "import trimesh\n"
            "r = x + 3  # uses the earlier namespace\n"
            "result = trimesh.creation.icosphere(subdivisions=1, radius=r)\n",
        )
        assert "validation" in p and p["ok"] is True, p.get("error")
        assert p["validation"]["isWatertight"]
        assert p["files"].get("stl")
        assert p.get("renders", {}).get("top"), "session exec missing renders"
        assert abs(p["geometry"]["dimensions"]["x"] - 16.0) < 0.5, p["geometry"]
        assert "result" in p["namespace"] and "r" in p["namespace"]

        # Snapshot the good state.
        r = client.post(f"/session/{sid}/snapshot")
        assert r.status_code == 200 and r.json()["ok"] is True, r.text[:200]

        # Clobber result with a tiny box (a "bad step").
        p = sess_exec(sid, "result = trimesh.creation.box(extents=(2, 2, 2))\n")
        assert p["ok"] is True
        assert abs(p["geometry"]["dimensions"]["x"] - 2.0) < 0.1, p["geometry"]

        # Rollback restores the checkpoint...
        r = client.post(f"/session/{sid}/rollback")
        assert r.status_code == 200 and r.json()["ok"] is True, r.text[:200]

        # ...and the next exec re-exports the restored sphere (presence of
        # `result` triggers the export path, not just fresh assignment).
        p = sess_exec(sid, "pass\n")
        assert "validation" in p and p["ok"] is True, p.get("error")
        assert abs(p["geometry"]["dimensions"]["x"] - 16.0) < 0.5, \
            f"rollback did not restore the sphere: {p['geometry']}"
    finally:
        delete_session(sid)

    # Deleted -> gone (fresh id space, not a tombstone).
    r = client.post(f"/session/{sid}/exec", json={"code": "pass"})
    assert r.status_code == 404, f"deleted session answered {r.status_code}"


def test_session_cap_429():
    """The registry refuses session #(CAD_SESSION_MAX+1) with 429."""
    sids = []
    try:
        for _ in range(app_module.SESSION_MAX):
            sids.append(create_session())
        r = client.post("/session", json={"engine": "mesh"})
        assert r.status_code == 429, \
            f"expected 429 over cap, got {r.status_code}: {r.text[:200]}"
    finally:
        for sid in sids:
            delete_session(sid)
    # Cap frees up after deletes.
    sid = create_session()
    delete_session(sid)


def test_session_exec_timeout_kills_session():
    """A hung exec returns the /run timeout error shape; the session is dead
    and subsequent calls get HTTP 410."""
    old_timeout = app_module.RUN_TIMEOUT_S
    app_module.RUN_TIMEOUT_S = 5
    sid = None
    try:
        sid = create_session()
        t0 = time.time()
        p = sess_exec(sid, "import time\ntime.sleep(120)\n")
        elapsed = time.time() - t0
        assert p["ok"] is False, p
        assert "timed out" in (p.get("error") or ""), p
        assert p["validation"]["compiled"] is False
        assert p["stdout"] == "" and p["namespace"] == []
        assert elapsed < 60, f"timeout did not cut the exec short ({elapsed:.0f}s)"

        sess_exec(sid, "pass", expect_status=410)
        r = client.post(f"/session/{sid}/snapshot")
        assert r.status_code == 410, f"snapshot on dead session: {r.status_code}"
    finally:
        app_module.RUN_TIMEOUT_S = old_timeout
        if sid is not None:
            delete_session(sid)  # tombstones remain deletable


TESTS = [
    test_run_mesh_sphere_multiview,
    test_run_opposed_iso_coverage_guarantee,
    test_run_hollow_part_gets_section,
    test_run_open_mesh_remesh_is_a_decision,
    test_run_voxel_kill_switch_still_global,
    test_run_checks_networks_two_cavities,
    test_run_script_declared_fluid_ports,
    test_run_fluid_ports_dict_shorthand_coerced,
    test_run_fluid_ports_garbage_is_an_error_not_a_skip,
    test_decimate_stl_to_cap_direct,
    test_decimate_voxel_fallback_preserves_cavities,
    test_run_checks_fea_supported_box,
    test_run_promotes_two_body_compound_to_assembly,
    test_run_debris_still_fails_fragment_gate,
    test_run_prefers_parts_dict_over_result_compound,
    test_run_promotes_thin_lid_compound,
    test_session_lifecycle,
    test_session_cap_429,
    test_session_exec_timeout_kills_session,
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
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} tests passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
