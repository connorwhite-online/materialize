"""
CAD execution sidecar for Materialize text-to-CAD.

A small, isolated HTTP service that runs a generated CAD script and returns
the exported files (STL/STEP), preview renders, geometry stats, and validity
flags. The Next.js app talks to it via lib/cad/runner-client.ts (one-shot
`/run`) and lib/cad/session-client.ts (stateful `/session/*`, MTR-177 /
docs/text-to-cad/03 §A).

Output contract: the script must assign its final solid to a variable named
`result` (a build123d/cadquery object, or a trimesh.Trimesh under
engine "mesh") or a `parts` dict for assemblies.

SECURITY: this executes model-generated Python. The container is the
trust boundary — deploy it network-disabled, non-root, read-only FS,
with memory/CPU caps (see Dockerfile). Per-run we additionally fork a
child process with resource limits and a wall-clock timeout so a hang or
OOM can't take down the service. Note the `exec` namespace is NOT a
sandbox: builtins (e.g. `__import__`, `os`) remain reachable from
generated code, so a script can run arbitrary Python — the container
boundary, not the namespace, is what contains it. Session mode extends
process lifetime but not the threat model: same container boundary, same
caveats. This is adequate for the owner-only v0; before any public/
multi-user exposure, move execution into a stronger sandbox (gVisor /
seccomp / per-run microVM). See the plan's "out of scope for v0" note.
"""

import base64
import contextlib
import hmac
import io
import json
import multiprocessing as mp
import os
import queue as queue_mod
import resource
import shutil
import sys
import tempfile
import threading
import time
import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

# Make the sibling modules (sdf_kit, networks, fea) importable from generated
# scripts and lazily inside the child, regardless of the process cwd — both
# in the Docker image (WORKDIR /app) and when tests import app.py by path.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

app = FastAPI(title="materialize-cad-runner")

# Defaults; override via env in the deployment.
# 600s wall clock. This is a HANG/RUNAWAY backstop, not a complexity budget:
# the exec namespace is not a sandbox (see module docstring), so without a
# ceiling one degenerate script pins the worker forever. It must therefore be
# generous enough that legitimately heavy geometry never hits it — a
# full-scale TPMS exchanger (150mm-class core: marching cubes + repair +
# multi-view renders + wall-resolution isolation probe + STL decimation)
# measures ~5-6 minutes end to end; the old 60s ceiling amputated it at the
# first mesh. CPU limit tracks it (below).
RUN_TIMEOUT_S = int(os.environ.get("CAD_RUN_TIMEOUT_S", "600"))
# RLIMIT_AS caps *virtual* address space, not RSS. Python + build123d +
# OpenCASCADE (plus numpy/scipy/BLAS) map well over 1 GB of address space at
# import time, so a low cap can ENOMEM before user code even runs. Default to
# 8 GB of headroom — virtual space is cheap (it's not physical RAM), and the
# Dockerfile's MALLOC_ARENA_MAX + single-threaded BLAS keep the actual mapped
# footprint small. The platform's container memory limit is the real
# physical-RAM bound; this rlimit only stops a single runaway script.
MEM_LIMIT_BYTES = int(
    os.environ.get("CAD_RUN_MEM_BYTES", str(8 * 1024 * 1024 * 1024))
)
# Track the wall-clock budget — CPU-bound work (marching cubes, OCC booleans)
# would otherwise hit SIGXCPU long before the wall-clock terminate fires.
# Default rides just under RUN_TIMEOUT_S so raising one via env raises both.
CPU_LIMIT_S = int(
    os.environ.get("CAD_RUN_CPU_S", str(max(RUN_TIMEOUT_S - 5, 5)))
)
# Session mode (docs/text-to-cad/03 §A): idle TTL + concurrent-session cap.
# Expiry is enforced by a lazy sweep on every session call — no background
# thread; this sidecar runs single-worker and the cap is tiny, so a reaper
# thread would be complexity without benefit.
SESSION_TTL_S = int(os.environ.get("CAD_SESSION_TTL_S", "600"))
SESSION_MAX = int(os.environ.get("CAD_SESSION_MAX", "4"))
# Per-SESSION cumulative caps (MTR-187). The one-shot /run path is bounded per
# request, but a session child is long-lived (up to SESSION_TTL_S), so per-exec
# limits alone let an attacker accumulate unbounded CPU / output / exec count
# across many execs inside one session. These bound the whole session:
#   - CPU seconds: the child's HARD RLIMIT_CPU (kernel SIGKILLs on breach) —
#     set in _apply_limits(session=True), re-armed (soft only) per exec.
#   - exec count + cumulative output bytes: tracked in _session_worker, which
#     ends the session on breach (the child exits; the parent then 410s later
#     calls). Memory is already bounded per child by RLIMIT_AS, and a session
#     child is one persistent process, so that cap is inherently cumulative.
# 900s: an agentic session on a large part legitimately spends several
# multi-minute meshes (explore, preview, final) — 300s starved those.
SESSION_CPU_BUDGET_S = int(os.environ.get("CAD_SESSION_CPU_S", "900"))
SESSION_MAX_EXECS = int(os.environ.get("CAD_SESSION_MAX_EXECS", "250"))
SESSION_MAX_OUTPUT_BYTES = int(
    os.environ.get("CAD_SESSION_MAX_OUTPUT_BYTES", str(512 * 1024 * 1024))
)
# Cap a single exported artifact (STL/STEP base64) so one script can't flood the
# caller with a multi-GB payload — the "output flood" resource bomb. RLIMIT_AS
# already bounds memory *inside* the child; this bounds what crosses the process
# boundary onto the queue and back to the app.
MAX_OUTPUT_BYTES = int(
    os.environ.get("CAD_MAX_OUTPUT_BYTES", str(96 * 1024 * 1024))
)
def _obs(event: str, **fields) -> None:
    """Structured observability: one JSON line per pipeline event on stdout
    ({"cad": "<event>", ...}), interleaved with uvicorn's access log. This is
    the sidecar's flight recorder — a session killed by CPU budget, a run
    that timed out, a decimated export — so a failed generation can be
    diagnosed from logs instead of archaeology. Grep with: `grep '"cad"'`.
    Never throws; logging must not break a run."""
    try:
        rec: dict = {"cad": event, "t": round(time.time(), 3)}
        rec.update({k: v for k, v in fields.items() if v is not None})
        print(json.dumps(rec), flush=True)
    except Exception:  # noqa: BLE001
        pass


RUNNER_SECRET = os.environ.get("CAD_RUNNER_SECRET", "")
# Prefer a secret read from a FILE (CAD_RUNNER_SECRET_FILE) over the env var
# (MTR-187). A secret in the environment is inherited by every spawned child and
# stays visible in that child's /proc/self/environ (the kernel keeps the initial
# stack copy even after `del os.environ[...]`), so generated code could read and
# return it via stdout. A file-mounted secret never enters the environment, so
# it never lands in /proc/*/environ. Env var stays supported for Railway-style
# deploys; the file is the hardened option.
_SECRET_FILE = os.environ.get("CAD_RUNNER_SECRET_FILE", "")
if _SECRET_FILE and not RUNNER_SECRET:
    try:
        with open(_SECRET_FILE) as _sf:
            RUNNER_SECRET = _sf.read().strip()
    except OSError:
        pass
# Fail closed: an empty secret would otherwise skip the bearer check entirely
# (see `_check_auth` below), turning a misconfigured deploy into an
# unauthenticated arbitrary-Python-execution endpoint. The container isolation
# (network-disabled, read-only FS) is a separate, manually-applied defense —
# don't rely on it alone. Set CAD_RUNNER_ALLOW_NO_AUTH=true only for local/dev
# runs where there is no public URL.
if not RUNNER_SECRET and os.environ.get("CAD_RUNNER_ALLOW_NO_AUTH", "") != "true":
    raise RuntimeError(
        "CAD_RUNNER_SECRET is required (unauthenticated code execution is not "
        "safe to expose). Set CAD_RUNNER_SECRET, or set "
        "CAD_RUNNER_ALLOW_NO_AUTH=true for local/dev runs only."
    )

# Named preview viewpoints (docs/text-to-cad/07 §A). threeQuarter is the
# legacy single render and keeps the full figure size; the extra views are
# smaller — they exist for the VLM judge and repair prompts, not for display.
# threeQuarterBack is the OPPOSED isometric (MTR-199): the two opposed isos
# together guarantee every face appears in at least one view, so rear / left /
# bottom features are covered by default rather than by suspicion.
_VIEW_ANGLES = {
    "threeQuarter": (22, -55),
    "threeQuarterBack": (22, 125),
    "top": (80, -90),
    "front": (0, -90),
    "side": (0, 0),
}
_FULL_FIGSIZE = (6.4, 4.8)
_SMALL_FIGSIZE = (4.0, 3.0)
# Below this (mesh volume / bounding-box volume) a part is treated as hollow
# (shell, bores, channels) and gets a section cutaway added to the packet so
# the judge / self-review can see the internal geometry (MTR-199).
_SECTION_FILL_RATIO = 0.75


class RunRequest(BaseModel):
    code: str
    formats: list[str] = ["stl", "step"]
    # Which code dialect the script is written in. "build123d" (default) or
    # "cadquery" — both ride OpenCASCADE; only the export call differs. Lets the
    # harness route to a different B-rep front-end (and A/B them) with one
    # sidecar. "mesh" = pure numpy/trimesh/sdf_kit scripts (no CAD kernel):
    # skips the kernel warm import and requires `result`/`parts` values to be
    # trimesh.Trimesh instances.
    engine: str = "build123d"
    # Permit the lossy voxel-remesh fallback for a non-watertight result
    # (docs/text-to-cad/02 §C: remesh is a decision, never a silent trade).
    # Default false: the caller gets the open-mesh diagnosis and decides.
    # CAD_VOXEL_FALLBACK=false remains the global kill switch on top.
    allowRemesh: bool = False
    # Optional post-export physics/plumbing probes (MTR-179/180), run in the
    # child on the produced mesh and attached as `checks` in the payload:
    #   {"networks": {"ports": [...], "pitch"?},
    #    "fea": {"loads": [...], "supports": [...], "resolution"?}}
    # Each check is failure-isolated: an error becomes {"error": str} for that
    # check, never a failed run.
    checks: Optional[dict] = None


class SessionCreateRequest(BaseModel):
    engine: str = "build123d"


class SessionExecRequest(BaseModel):
    code: str
    formats: list[str] = ["stl", "step"]
    allowRemesh: bool = False
    checks: Optional[dict] = None


class SessionImportStepRequest(BaseModel):
    # Off-the-shelf part sourcing (MTR-200): a base64 STEP fetched from the
    # step.parts catalog (sha256-verified + R2-cached upstream) to bind into the
    # session namespace under `name` for boolean/cavity/mate operations.
    stepB64: str
    name: str = "part"


def _check_auth(request: Request) -> None:
    """Bearer auth shared by /run and every /session endpoint."""
    if RUNNER_SECRET:
        auth = request.headers.get("authorization", "")
        if not hmac.compare_digest(auth, f"Bearer {RUNNER_SECRET}"):
            raise HTTPException(status_code=401, detail="unauthorized")


def _apply_limits(session: bool = False) -> None:
    """Cap address space + CPU in the child so runaway scripts die fast.

    One-shot children get a hard CPU cap == the per-run budget. Session
    children get a soft per-*exec* cap (`_extend_cpu_budget` re-arms it before
    each exec so accumulated work across healthy execs doesn't kill the session)
    UNDER a hard cap == SESSION_CPU_BUDGET_S: the kernel SIGKILLs the child once
    the session's cumulative CPU crosses that ceiling, which the parent sees as
    a crash and turns into a 410 (MTR-187 per-session cap). RLIMIT_AS bounds the
    child's address space either way."""
    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEM_LIMIT_BYTES, MEM_LIMIT_BYTES))
        if session:
            # Hard cap = whole-session CPU budget (an absolute ceiling); soft
            # cap = one exec's budget, clamped under the ceiling so the session
            # cap still bites even when it is set below the per-exec cap.
            hard = SESSION_CPU_BUDGET_S
            resource.setrlimit(
                resource.RLIMIT_CPU, (min(CPU_LIMIT_S, hard), hard)
            )
        else:
            resource.setrlimit(resource.RLIMIT_CPU, (CPU_LIMIT_S, CPU_LIMIT_S))
    except (ValueError, OSError):
        # Best-effort; the container limits are the real boundary.
        pass


def _extend_cpu_budget() -> None:
    """Re-arm the session child's soft CPU limit to `now + CPU_LIMIT_S` so each
    exec gets a fresh per-exec budget — but never above the hard cap
    (SESSION_CPU_BUDGET_S), so the cumulative session ceiling still bites."""
    try:
        used = resource.getrusage(resource.RUSAGE_SELF)
        budget = int(used.ru_utime + used.ru_stime) + CPU_LIMIT_S
        _, hard = resource.getrlimit(resource.RLIMIT_CPU)
        if hard != resource.RLIM_INFINITY:
            budget = min(budget, hard)
        resource.setrlimit(resource.RLIMIT_CPU, (budget, hard))
    except (ValueError, OSError):
        pass


# PEP-578 audit events (https://docs.python.org/3/library/audit_events.html)
# that model-generated CAD code has no legitimate reason to raise. Blocking them
# at the interpreter level is strictly stronger than the pre-exec AST denylist
# (validate.py): the hook fires no matter HOW the primitive is reached —
# `__import__("socket")`, `importlib.import_module("subprocess")`, a re-exported
# alias, `getattr(os, "sys"+"tem")` — because it sees the *operation*, not the
# import statement, so it closes the trivial "bypass the denylist in one line"
# gap that validate.py openly concedes. It is still NOT a sandbox: code that
# calls libc directly through a raw ctypes function pointer can bypass
# Python-level auditing, which is exactly why the container boundary (and, before
# non-owner exposure, gVisor/seccomp) remains the real control. The whole CAD
# stack (build123d, cadquery, trimesh, numpy, scipy, matplotlib-Agg,
# bd_warehouse) does none of these at runtime, so the hook is transparent to
# legitimate work — proven by the exemplar sweep + bd_warehouse smoke.
_BLOCKED_AUDIT_EVENTS = frozenset(
    {
        "socket.connect",
        "socket.bind",
        "socket.getaddrinfo",
        "socket.sethostname",
        "subprocess.Popen",
        "os.system",
        "os.exec",
        "os.spawn",
        "os.posix_spawn",
        "os.startfile",
    }
)


def _scrub_child_env() -> None:
    """Drop the runner secret and obviously-sensitive vars from the child's
    os.environ before untrusted code runs, so a script can't read them via
    `os.environ` and return them through stdout (MTR-187). The child never needs
    the runner secret — only the parent authenticates.

    LIMIT (documented in README residual risks): this scrubs the live os.environ
    mapping but NOT /proc/self/environ, which Linux keeps as the process's
    initial-stack copy that `unsetenv` does not rewrite. To keep a secret out of
    /proc entirely, provide it via CAD_RUNNER_SECRET_FILE (it then never enters
    the environment). The operational env vars (CAD_*) were already read into
    module globals at import, so removing them here changes no behavior."""
    for key in list(os.environ.keys()):
        upper = key.upper()
        if (
            key == "CAD_RUNNER_SECRET"
            or "SECRET" in upper
            or "TOKEN" in upper
            or "PASSWORD" in upper
            or "API_KEY" in upper
            or upper.endswith("_KEY")
        ):
            os.environ.pop(key, None)


def _install_exec_guard() -> None:
    """Install a PEP-578 audit hook that blocks network egress + process
    spawning from generated code (see `_BLOCKED_AUDIT_EVENTS`). Defense in
    depth, not a sandbox. Installed in the child AFTER the trusted kernel warm
    (so kernel imports are never second-guessed) and before any untrusted code
    runs; audit hooks cannot be removed once added (by design), and this one
    lives only in the child. Fails open — hardening must never wedge a run."""

    def _hook(event: str, args) -> None:  # noqa: ANN001
        if event in _BLOCKED_AUDIT_EVENTS:
            raise PermissionError(
                f"blocked operation '{event}': network and process access are "
                "not permitted in generated CAD code"
            )

    try:
        sys.addaudithook(_hook)
    except Exception:  # noqa: BLE001 — never let hardening break execution
        pass


# Rendering proxy ceiling: preview PNGs are ~640px — a multi-million-face
# TPMS mesh buys nothing there but costs matplotlib minutes per view (the
# painter's-algorithm sort is O(n log n) on faces with a big constant). The
# proxy is for PIXELS only; validation, checks, and exports always use the
# full mesh.
_RENDER_PROXY_FACES = int(os.environ.get("CAD_RENDER_PROXY_FACES", "400000"))


def _render_proxy(mesh):
    """Decimated stand-in for rendering only. Watertightness is irrelevant
    for pixels, so the fast quadric path is always acceptable here; any
    failure falls back to the full mesh."""
    try:
        if len(mesh.faces) > _RENDER_PROXY_FACES * 1.3:
            proxy = mesh.simplify_quadric_decimation(
                face_count=_RENDER_PROXY_FACES
            )
            if len(proxy.faces) > 0:
                return proxy
    except Exception:  # noqa: BLE001 — proxy is an optimization, never a gate
        pass
    return mesh


def _decimate_stl_to_cap(mesh, entry: dict):
    """Slim a copy of `mesh` so its binary STL fits under MAX_OUTPUT_BYTES
    (binary STL = 84 bytes header + 50 bytes/triangle). Large TPMS/lattice
    meshes legitimately exceed the cap (a 150mm gyroid core measures >200MB)
    — dropping the file made the whole build useless, and surface detail
    past ~2M triangles is below print resolution anyway.

    Two-step escalation, never shipping a broken STL:
      1. quadric decimation (fast_simplification) — best detail
         preservation, but on dense TPMS meshes it reliably leaves a few
         hundred non-manifold spots that no repair ladder closes (measured);
      2. occupancy voxel remesh — marching cubes over the cavity-aware
         `_solid_voxels` grid (NOT `.fill()`, which would pave internal
         channels shut) at a pitch computed to land under the face target.
         Guaranteed watertight by construction; loses ~pitch of surface
         detail, which is why it is the fallback, not the default.

    Returns the slimmed mesh or None (caller falls through to the
    drop-with-error path). Validation/geometry stay computed on the FULL
    mesh; only the exported artifact is slimmed, and the reduction (with
    method) is recorded on the entry so consumers can see it."""
    target = int((MAX_OUTPUT_BYTES * 0.9 - 84) / 50)
    if target <= 0 or len(mesh.faces) <= target:
        return None

    def record(slim, method, pitch=None):
        info = {
            "fromTriangles": int(len(mesh.faces)),
            "toTriangles": int(len(slim.faces)),
            "method": method,
        }
        if pitch is not None:
            info["pitch"] = round(float(pitch), 3)
        entry["decimatedForExport"] = info
        return slim

    try:
        import numpy as np

        slim = mesh.simplify_quadric_decimation(face_count=target)
        _weld_vertices(slim)
        # Export acceptance: CLOSED (zero boundary edges), consistently
        # wound, volume preserved, under the cap. Deliberately NOT
        # trimesh's is_watertight: quadric collapse on dense TPMS meshes
        # leaves a few hundred non-manifold T-junction edges (out of
        # millions) that no slicer trips on — while its vertices keep the
        # ORIGINAL smooth surface. Rejecting on that flag forced the voxel
        # remesh fallback, whose mid-cell vertices shipped a Minecraft
        # staircase to an actual user. Closed + volume-true is the bar;
        # the blemish count is recorded, not hidden.
        if (
            slim.is_winding_consistent
            and len(slim.faces) * 50 + 84 <= MAX_OUTPUT_BYTES
        ):
            edge_counts = np.unique(
                slim.edges_sorted, axis=0, return_counts=True
            )[1]
            open_edges = int((edge_counts == 1).sum())
            non_manifold = int((edge_counts > 2).sum())
            vol_ok = (
                float(mesh.volume) > 0
                and abs(float(slim.volume) / float(mesh.volume) - 1.0) < 0.02
            )
            if open_edges == 0 and vol_ok:
                slimmed = record(slim, "quadric")
                if non_manifold:
                    entry["decimatedForExport"]["nonManifoldEdges"] = (
                        non_manifold
                    )
                return slimmed
    except Exception:  # noqa: BLE001 — escalate to the voxel remesh
        pass

    try:
        import numpy as np
        import trimesh
        from skimage import measure as sk_measure

        from sdf_kit import _solid_voxels

        # Marching cubes emits ~2 triangles per pitch^2 of surface, so the
        # pitch that lands on `target` faces is sqrt(2*area/target); 10%
        # margin, then coarsen-and-retry for the estimate's error bar.
        pitch = float(np.sqrt(2.0 * float(mesh.area) / target)) * 1.1
        for _ in range(4):
            solid, origin = _solid_voxels(mesh, pitch, pad=2)
            # Signed distance from the occupancy grid (EDT both ways), NOT a
            # binary ±1 field: marching cubes interpolates vertices along the
            # gradient, so surfaces land at sub-voxel positions. A binary
            # field snaps every vertex to mid-cell and ships a Minecraft
            # staircase — exactly what a user saw in their STL viewer while
            # the full-res mesh (and every preview render) looked smooth.
            from scipy import ndimage as sp_ndimage

            F = (
                sp_ndimage.distance_transform_edt(~solid)
                - sp_ndimage.distance_transform_edt(solid)
            ).astype(np.float32)
            verts, faces, _, _ = sk_measure.marching_cubes(F, level=0.0)
            remesh = trimesh.Trimesh(
                vertices=origin + verts * pitch, faces=faces
            )
            remesh.merge_vertices()
            # NO fix_normals here: marching cubes orients faces from the
            # field gradient, which is already globally consistent — and for
            # a part with a sealed internal cavity, fix_normals re-orients
            # the disconnected cavity shell to positive volume, silently
            # ADDING the cavity's volume instead of subtracting it
            # (measured: hollow box 52k -> 92k mm^3). Guard only against a
            # globally-inverted result.
            if float(remesh.volume) < 0:
                remesh.invert()
            if len(remesh.faces) * 50 + 84 > MAX_OUTPUT_BYTES:
                pitch *= 1.25
                continue
            # Same sub-voxel debris filter as to_mesh: quantization can
            # shed closed slivers that would trip the fragment gate.
            try:
                bodies = remesh.split(only_watertight=False)
                if len(bodies) > 1:
                    tol = (2.0 * pitch) ** 3
                    kept = [b for b in bodies if abs(float(b.volume)) > tol]
                    if kept and len(kept) < len(bodies):
                        remesh = (
                            trimesh.util.concatenate(kept)
                            if len(kept) > 1
                            else kept[0]
                        )
            except Exception:  # noqa: BLE001 — debris filter is best-effort
                pass
            if remesh.is_watertight:
                return record(remesh, "voxel", pitch)
            pitch *= 1.25
    except Exception:  # noqa: BLE001 — slimming is best-effort
        pass
    return None


def _encode_output(raw: bytes, kind: str, entry: dict) -> Optional[str]:
    """Base64-encode an exported artifact, refusing anything over
    MAX_OUTPUT_BYTES (the output-flood bomb guard, MTR-187). On refusal the
    file is dropped and the reason is appended to the part's error so the caller
    sees why, rather than silently shipping a truncated blob."""
    if len(raw) > MAX_OUTPUT_BYTES:
        note = (
            f"{kind} export is {len(raw) // (1024 * 1024)}MB, over the "
            f"{MAX_OUTPUT_BYTES // (1024 * 1024)}MB output cap — dropped"
        )
        entry["error"] = f"{entry['error']}; {note}" if entry.get("error") else note
        return None
    return base64.b64encode(raw).decode()


def _reply_output_bytes(reply: dict) -> int:
    """Approximate serialized output size of a session reply (base64 file blobs
    + renders), for the per-session cumulative output cap."""
    total = 0
    for container in (reply.get("files"), *(
        p.get("files") for p in (reply.get("parts") or [])
    ), reply.get("renders")):
        if isinstance(container, dict):
            for v in container.values():
                if isinstance(v, str):
                    total += len(v)
    return total


def _warm_engine(engine: str) -> None:
    """Import the requested CAD kernel so exec-time imports are cheap. Only
    the requested one is imported, so a cadquery-only venv doesn't need
    build123d installed and vice-versa. "mesh" scripts use numpy/trimesh/
    sdf_kit only — nothing to warm."""
    if engine == "mesh":
        return
    if engine == "cadquery":
        import cadquery as _cq  # noqa: F401
    else:
        import build123d as _b3d  # noqa: F401
        # Standard-parts library (MTR-200): warming the fastener/bearing
        # modules here keeps exec-time `from bd_warehouse.fastener import ...`
        # cheap (they parse their CSV standards tables at import). Guarded so
        # an image built before bd_warehouse landed still boots — generated
        # code then just pays the import cost itself.
        try:
            import bd_warehouse.fastener as _bdw_f  # noqa: F401
            import bd_warehouse.bearing as _bdw_b  # noqa: F401
        except ImportError:
            pass


def _export_topology(shape, engine: str):
    """Best-effort B-rep topology sidecar (MTR-174 / docs/text-to-cad/01
    Phase 2): per-face tessellation with face/edge identity for exact viewer
    picking.

    Exercised only in the container image (needs OCP, which the dev/test env
    lacks); failure-isolated — the caller catches ANY exception from here and
    proceeds exactly as if "topo" had not been requested.

    Returns (topo_dict, trimesh.Trimesh). CRITICAL INVARIANT: the returned
    mesh is built from the SAME concatenated per-face tessellation the
    `triRange`s index, and the caller ships THAT mesh as the STL — exporting
    via the kernel separately would reorder triangles and silently break
    face picking.
    """
    import numpy as np
    import trimesh
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopExp import TopExp
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
    from OCP.TopTools import (
        TopTools_IndexedDataMapOfShapeListOfShape,
        TopTools_IndexedMapOfShape,
    )

    def _enum_name(value) -> str:
        # "GeomAbs_Cylinder" -> "cylinder" (docs 01: GetType name).
        return str(value).rsplit("_", 1)[-1].lower()

    def _xyz(p) -> list:
        return [float(p.X()), float(p.Y()), float(p.Z())]

    # Unwrap to the raw TopoDS_Shape across engines.
    topo_shape = getattr(shape, "wrapped", None)
    if topo_shape is None and hasattr(shape, "val"):  # cadquery Workplane
        topo_shape = shape.val().wrapped
    if topo_shape is None:
        raise ValueError(f"no TopoDS shape to tessellate (engine {engine})")

    # Tessellate the whole shape once; per-face triangulations are then read
    # back off each face. 0.1mm linear / 0.3rad angular tracks the kernel
    # exporters' defaults closely enough for picking.
    BRepMesh_IncrementalMesh(topo_shape, 0.1, False, 0.3, True)

    face_map = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(topo_shape, TopAbs_FACE, face_map)

    verts: list = []
    tris: list = []
    faces_meta: list = []
    for fi in range(1, face_map.Extent() + 1):
        face = TopoDS.Face_s(face_map.FindKey(fi))
        start = len(tris)
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            v_offset = len(verts)
            for i in range(1, tri.NbNodes() + 1):
                verts.append(_xyz(tri.Node(i).Transformed(trsf)))
            flip = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                if flip:
                    a, c = c, a
                tris.append([v_offset + a - 1, v_offset + b - 1, v_offset + c - 1])

        surf = BRepAdaptor_Surface(face)
        surface = _enum_name(surf.GetType())
        params = None
        try:
            if surface == "plane":
                pl = surf.Plane()
                params = {
                    "origin": _xyz(pl.Location()),
                    "normal": _xyz(pl.Axis().Direction()),
                }
            elif surface == "cylinder":
                cyl = surf.Cylinder()
                params = {
                    "origin": _xyz(cyl.Axis().Location()),
                    "axis": _xyz(cyl.Axis().Direction()),
                    "radius": float(cyl.Radius()),
                }
        except Exception:  # noqa: BLE001 — params are advisory
            params = None
        faces_meta.append(
            {
                "id": fi - 1,
                "surface": surface,
                "params": params,
                "triRange": [start, len(tris)],
            }
        )

    edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(
        topo_shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map
    )
    edges_meta: list = []
    for ei in range(1, edge_face_map.Extent() + 1):
        try:
            edge = TopoDS.Edge_s(edge_face_map.FindKey(ei))
            curve = BRepAdaptor_Curve(edge)  # throws on degenerate edges
            t0, t1 = float(curve.FirstParameter()), float(curve.LastParameter())
            n_pts = 24
            polyline = [
                _xyz(curve.Value(t0 + (t1 - t0) * i / (n_pts - 1)))
                for i in range(n_pts)
            ]
            face_ids = []
            # TopTools_ListOfShape is directly iterable under pybind OCP —
            # the classic ListIterator class isn't exposed in current wheels.
            for adjacent in edge_face_map.FindFromIndex(ei):
                idx = face_map.FindIndex(adjacent)
                if idx > 0:
                    face_ids.append(idx - 1)
            edges_meta.append(
                {
                    "id": ei - 1,
                    "curve": _enum_name(curve.GetType()),
                    "polyline": polyline,
                    "faceIds": sorted(set(face_ids)),
                }
            )
        except Exception:  # noqa: BLE001 — skip degenerate/seam edges
            continue

    # process=False keeps vertex/triangle order intact — triRange depends on it.
    tri_mesh = trimesh.Trimesh(
        vertices=np.asarray(verts, dtype=float),
        faces=np.asarray(tris, dtype=int),
        process=False,
    )
    if len(tri_mesh.faces) == 0:
        raise ValueError("topology tessellation produced no triangles")
    return {"faces": faces_meta, "edges": edges_meta}, tri_mesh



def _weld_vertices(mesh) -> None:
    """Scale-relative tolerance weld: OCC tessellates B-rep faces
    independently, so shared edges land as near-coincident (not identical)
    vertices — hairline cracks that read as open boundaries and fail the
    strict watertight gate on geometry that is actually perfect. Quantize
    to ~1e-5 of the largest extent (microns at part scale) and merge.
    Face order is preserved (only vertex indices remap), so this is safe
    on topo exports where triRange indexes the triangle list."""
    try:
        import numpy as np

        q = float(max(mesh.extents)) * 1e-5
        if q > 0:
            mesh.vertices = np.round(mesh.vertices / q) * q
        mesh.merge_vertices()
    except Exception:  # noqa: BLE001
        pass


def _process_shape(
    shape,
    formats: list[str],
    tmp: str,
    stem: str,
    engine: str = "build123d",
    allow_remesh: bool = False,
    include_views: bool = False,
):
    """Export + measure + render one solid. Returns (entry, mesh): the
    per-part payload (files, render(s), geometry, validity) plus the final
    trimesh (for post-export checks), or mesh None when analysis failed.
    Shared by the single-`result` path and each member of a multi-part
    `parts` assembly."""
    entry: dict = {
        "files": {},
        "renderPng": None,
        "geometry": None,
        "validation": {
            "compiled": True,
            "isSolid": False,
            "isWatertight": False,
            "isManifold": False,
        },
        "error": None,
    }
    import trimesh
    from trimesh import repair as trimesh_repair

    stl_path = os.path.join(tmp, f"{stem}.stl")
    # `result` may be a B-rep (build123d/cadquery) OR a trimesh.Trimesh (mesh
    # mode: implicit/TPMS/lattice/organic geometry the CAD kernel can't
    # express). Mesh mode has no BRep, so no STEP — STL comes straight off the
    # mesh.
    is_mesh = isinstance(shape, trimesh.Trimesh)
    mesh = None

    try:
        # Best-effort topology sidecar (MTR-174). On success the shipped STL
        # is the topo tessellation itself so triRange indexes it; on ANY
        # failure we fall through to the plain export path exactly as today.
        topo_exported = False
        if "topo" in formats and not is_mesh and engine in ("build123d", "cadquery"):
            try:
                topo_dict, mesh = _export_topology(shape, engine)
                if mesh is not None:
                    _weld_vertices(mesh)
                entry["topo"] = topo_dict
                mesh.export(stl_path)
                topo_exported = True
            except Exception:  # noqa: BLE001 — failure-isolated
                entry.pop("topo", None)
                mesh = None

        if is_mesh:
            mesh = shape
            entry["validation"]["isSolid"] = float(abs(mesh.volume) or 0.0) > 0.0
            mesh.export(stl_path)
        elif engine == "mesh":
            raise ValueError(
                "engine 'mesh' requires `result`/`parts` values to be "
                "trimesh.Trimesh instances"
            )
        elif engine == "cadquery":
            import cadquery as cq

            # CadQuery rides the same OCCT kernel; only the export call differs.
            if not topo_exported:
                cq.exporters.export(shape, stl_path)
            if "step" in formats:
                step_path = os.path.join(tmp, f"{stem}.step")
                cq.exporters.export(shape, step_path)
                with open(step_path, "rb") as f:
                    encoded = _encode_output(f.read(), "step", entry)
                if encoded is not None:
                    entry["files"]["step"] = encoded
            if not topo_exported:
                mesh = trimesh.load(stl_path, force="mesh")
            # isSolid from the loaded mesh (uniform across engines).
            entry["validation"]["isSolid"] = float(abs(mesh.volume) or 0.0) > 0.0
        else:
            from build123d import export_stl, export_step

            entry["validation"]["isSolid"] = (
                float(getattr(shape, "volume", 0.0) or 0.0) > 0.0
            )
            if not topo_exported:
                export_stl(shape, stl_path)
            # STEP comes straight from the OCC BRep (not the mesh).
            if "step" in formats:
                step_path = os.path.join(tmp, f"{stem}.step")
                export_step(shape, step_path)
                with open(step_path, "rb") as f:
                    encoded = _encode_output(f.read(), "step", entry)
                if encoded is not None:
                    entry["files"]["step"] = encoded
            if not topo_exported:
                mesh = trimesh.load(stl_path, force="mesh")

        # Best-effort cleanup so boolean-op artifacts (unwelded verts,
        # degenerate/duplicate faces, flipped winding, small holes) don't
        # hard-fail an otherwise-good model. Each step is independent and
        # optional across trimesh versions; the repaired mesh becomes the
        # printable STL we hand back. Skipped when topology was exported —
        # these steps reorder/drop triangles and would break triRange.
        if not topo_exported and (
            not mesh.is_watertight or not mesh.is_winding_consistent
        ):
            for step in (
                lambda: _weld_vertices(mesh),
                lambda: mesh.update_faces(mesh.nondegenerate_faces()),
                lambda: mesh.update_faces(mesh.unique_faces()),
                lambda: mesh.remove_unreferenced_vertices(),
                lambda: trimesh_repair.fix_winding(mesh),
                lambda: trimesh_repair.fix_normals(mesh),
                lambda: trimesh_repair.fill_holes(mesh),
            ):
                try:
                    step()
                except Exception:  # noqa: BLE001
                    pass
            try:
                mesh.export(stl_path)  # so files.stl matches what we validate
            except Exception:  # noqa: BLE001
                pass

        # Last-resort fallback for organic/complex results that repair can't
        # close: voxelize the solid and marching-cubes it back to a guaranteed-
        # watertight mesh. Trades crisp detail for an always-printable result,
        # so it is a DECISION, not a silent default (docs/text-to-cad/02 §C):
        # it requires the per-request allowRemesh flag on top of the
        # CAD_VOXEL_FALLBACK global kill switch. Never runs on a topo export
        # (it would replace the tessellation triRange indexes).
        voxel_enabled = os.environ.get("CAD_VOXEL_FALLBACK", "true") != "false"
        if (
            not mesh.is_watertight
            and voxel_enabled
            and allow_remesh
            and not topo_exported
        ):
            try:
                ext0 = mesh.extents
                max_dim = float(max(ext0)) or 1.0
                res = int(os.environ.get("CAD_VOXEL_RES", "80"))
                # Clamp so a thin/large model can't blow up the voxel grid.
                vox_per_axis = [max(1.0, e / (max_dim / res)) for e in ext0]
                while vox_per_axis[0] * vox_per_axis[1] * vox_per_axis[2] > 6e6:
                    res = int(res * 0.8)
                    vox_per_axis = [
                        max(1.0, e / (max_dim / res)) for e in ext0
                    ]
                pitch = max_dim / res
                vg = mesh.voxelized(pitch=pitch).fill()
                remeshed = vg.marching_cubes
                # marching_cubes returns index space; map back to model (mm).
                remeshed.apply_transform(vg.transform)
                if remeshed.is_watertight:
                    mesh = remeshed
                    entry["remeshed"] = True
                    try:
                        mesh.export(stl_path)
                    except Exception:  # noqa: BLE001
                        pass
            except Exception:  # noqa: BLE001
                pass

        # Still open: hand back a cheap diagnosis so the repair prompt has
        # something concrete to chew on (docs/text-to-cad/02 §C), instead of a
        # bare isWatertight:false.
        if not mesh.is_watertight:
            euler = None
            broken = None
            try:
                euler = int(mesh.euler_number)
            except Exception:  # noqa: BLE001
                pass
            try:
                broken = int(len(trimesh_repair.broken_faces(mesh)))
            except Exception:  # noqa: BLE001
                pass
            diag = "mesh is not watertight after repair"
            details = []
            if euler is not None:
                details.append(f"euler number {euler} (closed surface would be 2)")
            if broken is not None:
                details.append(f"{broken} faces touch open boundary edges")
            if details:
                diag += ": " + ", ".join(details)
            if voxel_enabled and not allow_remesh and not topo_exported:
                diag += (
                    "; voxel remesh skipped (allowRemesh=false) — retry with "
                    "allowRemesh=true to accept a lossy watertight approximation"
                )
            entry["error"] = diag

        entry["validation"]["isWatertight"] = bool(mesh.is_watertight)
        entry["validation"]["isManifold"] = bool(mesh.is_winding_consistent)
        # Fragment gate: a mesh can be watertight and still contain floating
        # debris — disconnected islands that print as loose chips (each island
        # closed = whole mesh "watertight"). One exported part = ONE fused
        # solid; separate pieces belong in the parts dict.
        try:
            bodies = mesh.split(only_watertight=False)
            body_count = max(1, len(bodies))
        except Exception:  # noqa: BLE001
            bodies = []
            body_count = 1
        entry["validation"]["bodyCount"] = int(body_count)
        if body_count > 1 and not entry["error"]:
            try:
                vols = sorted(
                    (abs(float(b.volume)) for b in bodies), reverse=True
                )[:5]
                vol_s = ", ".join(f"{v:.0f}" for v in vols)
            except Exception:  # noqa: BLE001
                vol_s = "?"
            entry["error"] = (
                f"part contains {body_count} disconnected solids (volumes "
                f"{vol_s} mm^3) — every exported part must be one fused "
                "solid: union intentional geometry into the body, delete "
                "stray debris, or export separate pieces via the parts dict"
            )
        ext = mesh.extents
        entry["geometry"] = {
            "dimensions": {
                "x": float(ext[0]),
                "y": float(ext[1]),
                "z": float(ext[2]),
            },
            "volume": float(mesh.volume),
            "triangleCount": int(len(mesh.faces)),
        }
        if include_views:
            # Multi-view renders (docs/text-to-cad/07 §A): threeQuarter at the
            # legacy full size, the extra views smaller. renderPng stays the
            # threeQuarter view for compatibility. All views draw the RENDER
            # PROXY — a large TPMS mesh at full resolution costs matplotlib
            # minutes per view and was the wall-clock hog on 150mm exchangers.
            draw = _render_proxy(mesh)
            renders: dict = {}
            for view, (elev, azim) in _VIEW_ANGLES.items():
                figsize = _FULL_FIGSIZE if view == "threeQuarter" else _SMALL_FIGSIZE
                png = _render(draw, elev=elev, azim=azim, figsize=figsize)
                if png:
                    renders[view] = png
            # Section cutaway for hollow parts (MTR-199): a mid-plane slice
            # reveals bores / channels / shell interiors that no exterior view
            # can show. Gated on a cheap fill-ratio heuristic so solid parts
            # don't get a pointless (and misleading) empty section. Sliced on
            # the proxy too — pixels only.
            try:
                ex = mesh.extents
                bbox_vol = float(ex[0]) * float(ex[1]) * float(ex[2])
                fill = float(mesh.volume) / bbox_vol if bbox_vol > 0 else 1.0
                if fill < _SECTION_FILL_RATIO:
                    section = _render_section(draw)
                    if section:
                        renders["section"] = section
            except Exception:  # noqa: BLE001
                pass
            entry["renders"] = renders
            entry["renderPng"] = renders.get("threeQuarter")
        else:
            entry["renderPng"] = _render(_render_proxy(mesh))
    except Exception as mesh_err:  # noqa: BLE001
        entry["error"] = f"analysis: {mesh_err}"
        mesh = None

    # Encode the (possibly repaired) STL, under the output-flood cap. An
    # over-cap STL from a valid mesh is decimated to fit first (large TPMS
    # meshes); only when that fails does the cap drop the file.
    if "stl" in formats and os.path.exists(stl_path):
        try:
            if (
                mesh is not None
                and os.path.getsize(stl_path) > MAX_OUTPUT_BYTES
            ):
                slim = _decimate_stl_to_cap(mesh, entry)
                if slim is not None:
                    slim.export(stl_path)
        except Exception:  # noqa: BLE001 — fall through to the plain cap
            pass
        with open(stl_path, "rb") as f:
            encoded = _encode_output(f.read(), "stl", entry)
        if encoded is not None:
            entry["files"]["stl"] = encoded

    return entry, mesh


def _plain(obj):
    """Recursively coerce numpy scalars/arrays to JSON-safe Python natives —
    check results pass through multiprocessing + FastAPI's JSON encoder."""
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if hasattr(obj, "tolist"):  # numpy array
        return obj.tolist()
    if hasattr(obj, "item"):  # numpy scalar
        try:
            return obj.item()
        except Exception:  # noqa: BLE001
            return obj
    return obj


def _coerce_fluid_ports(declared):
    """Liberal parse of a script's `fluid_ports` -> (ports, error). Canonical
    form is a list of {"name", "point": [x,y,z], "r"}; generated scripts also
    emit dicts of name -> point-tuple or name -> {"point"/"center", "r"}, so
    accept those rather than silently skipping the isolation check. The probe
    radius defaults to 2mm when omitted (the sphere only needs to overlap
    open fluid space). Returns (None, message) when the declaration cannot be
    understood — the caller surfaces that as a networks-check error."""
    _BAD = (
        "fluid_ports malformed — expected a list of "
        '{"name": "a_in", "point": [x, y, z], "r": mm} entries '
        "(names <circuit>_<role>, e.g. a_in/a_out/b_in/b_out)"
    )
    items = []
    if isinstance(declared, dict):
        for name, v in declared.items():
            if isinstance(v, dict):
                items.append({
                    "name": name,
                    "point": v.get("point", v.get("center")),
                    "r": v.get("r", v.get("radius", 2.0)),
                })
            else:
                items.append({"name": name, "point": v, "r": 2.0})
    elif isinstance(declared, (list, tuple)):
        items = list(declared)
    else:
        return None, _BAD
    try:
        ports = [
            {
                "name": str(p["name"]),
                "point": [float(c) for c in p["point"]],
                "r": float(p.get("r", 2.0)),
            }
            for p in items
        ]
    except Exception as err:  # noqa: BLE001
        return None, f"{_BAD} ({err})"
    if not ports or any(len(p["point"]) != 3 for p in ports):
        return None, _BAD
    return ports, None


def _coerce_fluid_plugs(declared):
    """Liberal parse of `fluid_plugs` -> (plugs, error). Canonical forms are
    {"a": [x,y,z], "b": [x,y,z], "r"} capsules (port bores, refilled) and
    {"c": [x,y,z], "h": [hx,hy,hz]} boxes (hood-loft windows — exchanger_core
    emits these for hosed ports); a dict of name -> plug is also accepted.
    Anything else — including axis/center shorthand that omits the capsule
    length — is an ERROR, not a silent drop: running the check with the
    plugs discarded guarantees a false leak through outside air and burns
    repair turns on a phantom."""
    _BAD = (
        "fluid_plugs malformed — expected a list of "
        '{"a": [x, y, z], "b": [x, y, z], "r": mm} capsules and/or '
        '{"c": [x, y, z], "h": [hx, hy, hz]} boxes spanning each port '
        "opening (exchanger_core returns these ready-made)"
    )
    if isinstance(declared, dict):
        items = list(declared.values())
    elif isinstance(declared, (list, tuple)):
        items = list(declared)
    else:
        return None, _BAD
    plugs = []
    try:
        for p in items:
            if "c" in p and "h" in p:
                plug = {
                    "c": [float(v) for v in p["c"]],
                    "h": [float(v) for v in p["h"]],
                }
                if len(plug["c"]) != 3 or len(plug["h"]) != 3:
                    return None, _BAD
            else:
                plug = {
                    "a": [float(v) for v in p["a"]],
                    "b": [float(v) for v in p["b"]],
                    "r": float(p["r"]),
                }
                if len(plug["a"]) != 3 or len(plug["b"]) != 3:
                    return None, _BAD
            plugs.append(plug)
    except Exception as err:  # noqa: BLE001
        return None, f"{_BAD} ({err})"
    return plugs, None


def _run_checks(mesh, checks: dict) -> dict:
    """Post-export physics/plumbing probes (MTR-179/180) on the final mesh.
    Runs in the child; networks/fea are imported lazily so /run stays cheap
    when no checks are requested. Each check is failure-isolated: it reports
    {"error": str} rather than ever crashing the run."""
    out: dict = {}
    net = checks.get("networks")
    if net is not None:
        if net.get("error"):
            # Pre-diagnosed failure (malformed fluid_ports/fluid_plugs):
            # surface it verbatim. Never run the check with an empty port
            # list — zero ports vacuously grades "isolated" and would turn
            # a broken declaration into a false PASS.
            out["networks"] = {"error": str(net["error"])}
        else:
            try:
                from networks import check_networks

                out["networks"] = _plain(
                    check_networks(
                        mesh,
                        net.get("ports") or [],
                        pitch=net.get("pitch"),
                        plugs=net.get("plugs"),
                        min_feature=net.get("minFeature"),
                    )
                )
            except Exception as err:  # noqa: BLE001
                out["networks"] = {"error": str(err)}
    fea_spec = checks.get("fea")
    if fea_spec is not None:
        try:
            from fea import fea_probe

            out["fea"] = _plain(
                fea_probe(
                    mesh,
                    fea_spec.get("loads") or [],
                    fea_spec.get("supports") or [],
                    resolution=int(fea_spec.get("resolution", 32)),
                )
            )
        except Exception as err:  # noqa: BLE001
            out["fea"] = {"error": str(err)}
    fit_spec = checks.get("fit")
    if fit_spec is not None:
        # Component-fit verifier (MTR-204): cavity containment, boss↔hole
        # pattern match, cutout↔port alignment against the produced mesh.
        try:
            from fit import check_fit

            out["fit"] = _plain(check_fit(mesh, fit_spec))
        except Exception as err:  # noqa: BLE001
            out["fit"] = {"error": str(err)}
    return out


def _base_payload(compiled: bool = False) -> dict:
    return {
        "ok": False,
        "files": {},
        "renderPng": None,
        "geometry": None,
        "remeshed": False,
        "validation": {
            "compiled": compiled,
            "isSolid": False,
            "isWatertight": False,
            "isManifold": False,
        },
        "error": None,
    }


# Fragment-gate assembly rescue (MTR-213). A single `result` that splits into a
# few large, comparable-volume, individually-watertight bodies is almost always
# a base+lid enclosure the script returned as one compound instead of a `parts`
# dict. Rather than hard-failing the fragment gate (which pushes the repair loop
# toward fusing the shells into one shallow shell and losing a piece), promote it
# into a real assembly. Conservative by construction: only comparable large
# watertight bodies with negligible debris promote — a solid trailing stray chips
# stays an error so the genuine debris case is still caught.
_PROMOTE_MIN_PARTS = 2
_PROMOTE_MAX_PARTS = 4
_PROMOTE_SLIVER_VOLUME = 1.0  # mm^3 — a body below this is a tessellation sliver
# Thin lids / hollow shells are often << the base volume; 15% rejected real
# two-piece enclosures and left a stacked compound in the preview with no
# parts[]. 5% still rejects a 5³ chip next to a ~40×30×20 solid (~0.6%).
_PROMOTE_LARGE_FRAC = 0.05


def _shape_z(shape) -> float:
    """Z of a shape's center — trimesh (`.centroid`) or B-rep (`.center()`)."""
    c = getattr(shape, "centroid", None)
    if c is not None:
        try:
            return float(c[2])
        except Exception:  # noqa: BLE001
            pass
    center = getattr(shape, "center", None)
    if callable(center):
        try:
            v = center()
            return float(getattr(v, "Z", None) if hasattr(v, "Z") else v[2])
        except Exception:  # noqa: BLE001
            pass
    # CadQuery solid
    try:
        return float(shape.Center().z)
    except Exception:  # noqa: BLE001
        return 0.0


def _name_parts_by_z(items):
    """Order solids/meshes low→high z; name base/lid for the two-body case."""
    ordered = sorted(items, key=lambda bv: _shape_z(bv[0]))
    names = (
        ["base", "lid"]
        if len(ordered) == 2
        else [f"part{i + 1}" for i in range(len(ordered))]
    )
    return [(names[i], ordered[i][0]) for i in range(len(ordered))]


def _explode_brep_solids(shape, engine: str):
    """If a B-rep `result` is a multi-solid compound, return [(name, solid)]
    ordered low→high z so we can promote BEFORE mesh export and keep STEP.
    Returns None for meshes, single solids, or when solids can't be listed."""
    import trimesh

    if isinstance(shape, trimesh.Trimesh):
        return None
    try:
        if engine == "build123d":
            solids = list(shape.solids())
        elif engine == "cadquery":
            solids_sel = shape.solids() if hasattr(shape, "solids") else None
            if solids_sel is None:
                return None
            solids = (
                list(solids_sel.vals())
                if hasattr(solids_sel, "vals")
                else list(solids_sel)
            )
        else:
            return None
    except Exception:  # noqa: BLE001
        return None
    if len(solids) < _PROMOTE_MIN_PARTS or len(solids) > _PROMOTE_MAX_PARTS:
        return None
    # Mirror the mesh promoter's volume gate so a solid + loose chip isn't
    # silently accepted as an assembly just because it's still B-rep.
    try:
        vols = [abs(float(getattr(s, "volume", 0.0) or 0.0)) for s in solids]
    except Exception:  # noqa: BLE001
        vols = [0.0] * len(solids)
    v_max = max(vols) if vols else 0.0
    if v_max < _PROMOTE_SLIVER_VOLUME:
        return None
    large, other = [], []
    for s, v in zip(solids, vols):
        (large if v >= _PROMOTE_LARGE_FRAC * v_max else other).append((s, v))
    if not (_PROMOTE_MIN_PARTS <= len(large) <= _PROMOTE_MAX_PARTS):
        return None
    if any(v >= _PROMOTE_SLIVER_VOLUME for _, v in other):
        return None
    return _name_parts_by_z(large)


def _promote_disconnected_bodies(mesh):
    """Decide whether a multi-body `result` mesh is a clean assembly worth
    rescuing (MTR-213). Returns a list of (name, submesh) ordered low->high z
    (base/lid for the two-body case) when the split is a clean assembly, else
    None so the fragment-gate debris error stands.

    Pure + side-effect-free so run_tests.py can unit-test it without the kernel."""
    try:
        bodies = list(mesh.split(only_watertight=False))
    except Exception:  # noqa: BLE001
        return None
    if len(bodies) < _PROMOTE_MIN_PARTS:
        return None
    vols = [abs(float(b.volume)) for b in bodies]
    v_max = max(vols) if vols else 0.0
    if v_max < _PROMOTE_SLIVER_VOLUME:
        return None
    # "Real parts" are bodies >= _PROMOTE_LARGE_FRAC of the biggest; that
    # separates a genuine base+thin-lid from a solid trailing a stray chip.
    large, other = [], []
    for b, v in zip(bodies, vols):
        (large if v >= _PROMOTE_LARGE_FRAC * v_max else other).append((b, v))
    if not (_PROMOTE_MIN_PARTS <= len(large) <= _PROMOTE_MAX_PARTS):
        return None
    # Only sub-mm^3 tessellation slivers are tolerated alongside the parts. Any
    # non-comparable body ABOVE that is genuine debris (a loose nub / un-unioned
    # feature) — keep the fragment error so the model fixes it, don't silently
    # drop it.
    if any(v >= _PROMOTE_SLIVER_VOLUME for _, v in other):
        return None
    # Each real part must be individually watertight — a printable piece, not an
    # open shell that only reads closed as part of the compound.
    if not all(bool(b.is_watertight) for b, _ in large):
        return None
    return _name_parts_by_z(large)


def _assemble_parts_payload(
    payload: dict,
    items: list,
    formats: list[str],
    tmp: str,
    engine: str,
    allow_remesh: bool,
) -> None:
    """Fill `payload` from a list of (name, shape) assembly members — shared by
    the explicit `parts` dict branch and the MTR-213 promotion path.

    Per-part: single render only, and no per-part topo — 4 PNGs plus a topology
    sidecar per part would balloon the payload (all base64 over one queue/pipe).
    The multi-view/topo consumers work on the top-level single result."""
    part_formats = [f for f in formats if f != "topo"]
    parts: list[dict] = []
    all_ok = True
    for i, (name, shape) in enumerate(items):
        stem = "".join(
            c if c.isalnum() else "-" for c in str(name)
        ).strip("-") or f"part{i}"
        entry, _mesh = _process_shape(
            shape, part_formats, tmp, stem, engine, allow_remesh
        )
        parts.append({"name": str(name), **entry})
        all_ok = all_ok and (
            entry["validation"]["isSolid"]
            and entry["validation"]["isWatertight"]
            and entry["validation"].get("bodyCount", 1) == 1
        )
    # Top-level mirrors the first part for single-part consumers.
    first = parts[0]
    payload["files"] = first["files"]
    payload["renderPng"] = first["renderPng"]
    payload["geometry"] = first["geometry"]
    # Aggregate validity = AND across parts.
    payload["validation"] = {
        "compiled": True,
        "isSolid": all(p["validation"]["isSolid"] for p in parts),
        "isWatertight": all(p["validation"]["isWatertight"] for p in parts),
        "isManifold": all(p["validation"]["isManifold"] for p in parts),
    }
    payload["parts"] = parts
    payload["remeshed"] = any(p.get("remeshed") for p in parts)
    if first.get("decimatedForExport"):
        payload["decimatedForExport"] = first["decimatedForExport"]
    # Feature chips for assemblies: this branch never emitted them at all,
    # so multi-part builds silently lost every chip. No per-part topo ships
    # (see docstring), so faceIds can't resolve — pass no shape and emit
    # params + spans only, the same graceful degradation the chip contract
    # already documents ("empty when the op's faces didn't survive").
    try:
        from features import finalize_features

        feats = finalize_features(None, None)
        if feats:
            payload["features"] = feats
    except Exception:  # noqa: BLE001
        pass
    payload["ok"] = all_ok


def _build_run_payload(
    ns: dict,
    formats: list[str],
    engine: str,
    allow_remesh: bool,
    checks: Optional[dict],
) -> dict:
    """Build the full /run response payload from an exec'd namespace holding
    `result` (single solid) or `parts` ({name: solid}). Shared by the one-shot
    child (`_execute`) and the session worker, so both reply in one shape.

    `ok` requires a solid AND watertight result — an open mesh with the remesh
    fallback declined is a failure the caller decides on (repair turn, retry
    with allowRemesh, or decompose), carrying the diagnosis in `error`.
    """
    payload = _base_payload(compiled=True)
    single = ns.get("result")
    parts_ns = ns.get("parts")

    # Script-declared fluid ports (dual-fluid exchangers): the geometry author
    # knows where its circuits open, the caller can't guess coordinates. A
    # `fluid_ports` declaration in the namespace (e.g. straight from
    # exchanger_core()) requests the networks isolation check on the produced
    # mesh. Request-supplied checks win. Malformed declarations are NOT
    # silently ignored: a script that clearly TRIED to declare circuits but
    # got the shape wrong must surface as a check error the repair loop can
    # act on — silence here once shipped an unverified solid block as a
    # "finished" exchanger (the model used a dict of name->tuple, the old
    # isinstance(list) gate skipped it, and nothing downstream noticed).
    declared = ns.get("fluid_ports")
    if declared:
        ports, ports_err = _coerce_fluid_ports(declared)
        plugs_decl = ns.get("fluid_plugs")
        plugs, plugs_err = (None, None)
        if plugs_decl:
            plugs, plugs_err = _coerce_fluid_plugs(plugs_decl)
        checks = dict(checks or {})
        if ports_err or plugs_err:
            checks.setdefault(
                "networks", {"error": ports_err or plugs_err}
            )
        else:
            spec: dict = {"ports": ports}
            if plugs:
                spec["plugs"] = plugs
            # `fluid_min_feature` (mm): the finest wall/channel the isolation
            # verdict must resolve — scripts set it alongside fluid_ports
            # (typically = wall). Keeps the probe honest on large parts.
            mf = ns.get("fluid_min_feature")
            if isinstance(mf, (int, float)) and float(mf) > 0:
                spec["minFeature"] = float(mf)
            checks.setdefault("networks", spec)

    with tempfile.TemporaryDirectory() as tmp:
        # Prefer an explicit `parts` dict when both are assigned — the prompt
        # forbids both, but models still emit `result = compound` alongside
        # `parts = {...}`. Taking `result` first used to discard a correct
        # split and leave a stacked compound in the preview.
        if isinstance(parts_ns, dict) and parts_ns:
            _assemble_parts_payload(
                payload, list(parts_ns.items()), formats, tmp, engine,
                allow_remesh,
            )
        elif single is not None:
            # B-rep multi-solid compound → promote BEFORE mesh export so each
            # part keeps editable STEP (mesh promotion can only ship STL).
            brep_parts = _explode_brep_solids(single, engine)
            if brep_parts is not None:
                _assemble_parts_payload(
                    payload, brep_parts, formats, tmp, engine, allow_remesh
                )
                payload["promotedFromSingle"] = True
            else:
                entry, mesh = _process_shape(
                    single, formats, tmp, "model", engine, allow_remesh,
                    include_views=True,
                )
                # Mesh assembly rescue (MTR-213): a watertight multi-body
                # `result` promotes to a real base/lid assembly when it's a
                # clean split rather than hard-failing into a fuse repair.
                promoted = None
                if (
                    mesh is not None
                    and entry["validation"].get("bodyCount", 1) > 1
                    and entry["validation"].get("isWatertight")
                ):
                    promoted = _promote_disconnected_bodies(mesh)
                if promoted is not None:
                    _assemble_parts_payload(
                        payload, promoted, formats, tmp, engine, allow_remesh
                    )
                    payload["promotedFromSingle"] = True
                    # Fit/network checks reference the whole enclosure.
                    if checks and mesh is not None:
                        payload["checks"] = _run_checks(mesh, checks)
                else:
                    payload["files"] = entry["files"]
                    payload["renderPng"] = entry["renderPng"]
                    if entry.get("renders") is not None:
                        payload["renders"] = entry["renders"]
                    payload["geometry"] = entry["geometry"]
                    payload["validation"] = entry["validation"]
                    payload["remeshed"] = bool(entry.get("remeshed"))
                    if entry.get("decimatedForExport"):
                        payload["decimatedForExport"] = entry["decimatedForExport"]
                    if entry.get("topo") is not None:
                        payload["topo"] = entry["topo"]
                    try:
                        from features import finalize_features

                        feats = finalize_features(single, entry.get("topo"))
                        if feats:
                            payload["features"] = feats
                    except Exception:  # noqa: BLE001
                        pass
                    if entry["error"]:
                        payload["error"] = entry["error"]
                    payload["ok"] = (
                        entry["validation"]["isSolid"]
                        and entry["validation"]["isWatertight"]
                        and entry["validation"].get("bodyCount", 1) == 1
                    )
                    if checks and mesh is not None:
                        payload["checks"] = _run_checks(mesh, checks)
        else:
            payload["error"] = (
                "script did not assign `result` or a non-empty `parts` dict"
            )

    return payload


def _pre_exec_reason(code: str) -> Optional[str]:
    """Cheap pre-exec source guard (MTR-187): return a reason to reject the
    script (unparseable, or an obvious egress/process-spawn import) before we
    fork+exec it, or None to proceed. Defense-in-depth, NOT a sandbox — the
    container boundary is the real control. Fails OPEN: any problem importing
    or running the guard proceeds to exec, so a broken guard can never wedge
    generation. Enforcement is gated by CAD_AST_VALIDATE (default on)."""
    try:
        from validate import validate_source, validation_enabled

        if not validation_enabled():
            return None
        return validate_source(code)
    except Exception:  # noqa: BLE001 — guard unavailable → fail open
        return None


def _execute(
    code: str,
    formats: list[str],
    out: "mp.Queue",
    engine: str = "build123d",
    allow_remesh: bool = False,
    checks: Optional[dict] = None,
) -> None:
    """One-shot child-process worker: exec the script, export, measure,
    validate. Output contract: the script assigns either `result` (a single
    solid) OR `parts` (a dict {name: solid} for a multi-part assembly). For an
    assembly the top-level fields mirror the first part (so single-part
    consumers keep working) and the full per-part breakdown is returned under
    `parts`."""
    _apply_limits()
    payload = _base_payload()
    reason = _pre_exec_reason(code)
    if reason is not None:
        payload["error"] = f"rejected before execution: {reason}"
        out.put(payload)
        return
    try:
        # Warm the kernel for the chosen engine (the script also imports what
        # it needs); no-op for "mesh".
        _warm_engine(engine)
        # Lock down AFTER the trusted warm, BEFORE the untrusted script runs
        # (MTR-187): scrub secrets from the child env, then block egress/spawn.
        _scrub_child_env()
        _install_exec_guard()

        # Feature-chip instrumentation (construction ops → face ids). Best-
        # effort: never fails the run if hooks can't install.
        try:
            from features import ensure_feature_hooks

            ensure_feature_hooks(engine, code)
        except Exception:  # noqa: BLE001
            pass

        ns: dict = {}
        exec(compile(code, "<generated>", "exec"), ns, ns)  # noqa: S102
        payload["validation"]["compiled"] = True

        payload = _build_run_payload(ns, formats, engine, allow_remesh, checks)
        out.put(payload)
    except Exception as err:  # noqa: BLE001
        payload["error"] = str(err)
        out.put(payload)


def _render(mesh, elev: float = 22, azim: float = -55, figsize=(6.4, 4.8)) -> Optional[str]:
    """Headless clay-style preview PNG (base64) from a named viewpoint.

    Uses matplotlib's Agg backend rather than trimesh's `scene.save_image`,
    which needs a live OpenGL/pyglet context and silently fails headless (on
    macOS dev and most servers) — leaving every render empty. That empty
    render is load-bearing now: the VLM aesthetic judge and the repair loop
    feed on it, so a real (if simple) Lambert-shaded view matters more
    than photoreal GL. Returns None on any failure — callers tolerate it."""
    fig = None
    try:
        import numpy as np
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection

        tris = mesh.triangles  # (n, 3, 3)
        if len(tris) == 0:
            return None

        # Cheap Lambert shading against a fixed key light for a clay read.
        light = np.array([0.4, 0.5, 0.75])
        light = light / np.linalg.norm(light)
        shade = np.clip(np.abs(mesh.face_normals @ light), 0.15, 1.0)
        base = np.array([0.62, 0.64, 0.67])  # neutral gray
        colors = np.clip(base[None, :] * (0.45 + 0.6 * shade)[:, None], 0, 1)

        fig = plt.figure(figsize=figsize, dpi=100)
        ax = fig.add_subplot(111, projection="3d")
        ax.add_collection3d(
            Poly3DCollection(tris, facecolors=colors, edgecolors="none")
        )

        bounds = mesh.bounds  # (2, 3) min/max
        center = bounds.mean(axis=0)
        span = float((bounds[1] - bounds[0]).max()) * 0.6 or 1.0
        ax.set_xlim(center[0] - span, center[0] + span)
        ax.set_ylim(center[1] - span, center[1] + span)
        ax.set_zlim(center[2] - span, center[2] + span)
        try:
            ax.set_box_aspect((1, 1, 1))
        except Exception:  # noqa: BLE001 — older mpl lacks set_box_aspect
            pass
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()

        buf = io.BytesIO()
        fig.savefig(
            buf, format="png", bbox_inches="tight", pad_inches=0, transparent=True
        )
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:  # noqa: BLE001
        return None
    finally:
        # Guarantee the Figure is released even when an exception fires
        # between creation and the (now-removed) success-path close —
        # in session mode (_session_worker) a leaked Figure per failed
        # render accumulates toward the container memory cap.
        if fig is not None:
            plt.close(fig)


def _render_section(mesh) -> Optional[str]:
    """Mid-plane section cutaway PNG (base64) for a hollow part (MTR-199).

    Slices the mesh in half along its LONGEST horizontal axis at the centroid,
    caps the cut so interior walls read as solid faces, and renders the
    remaining half from a viewpoint facing the cut plane. This is the cheap
    half of the cross-section tooling (MTR-40 owns the interactive viewer
    version): it exists so the VLM judge and the agentic self-review can see
    bores / channels / shell interiors that no exterior view exposes.

    Returns None on any failure — callers treat the section view as optional."""
    try:
        import numpy as np
        import trimesh

        center = mesh.bounds.mean(axis=0)
        # Cut across the longer of X/Y so the reveal shows the most interior.
        ext = mesh.extents
        axis = 0 if float(ext[0]) >= float(ext[1]) else 1
        normal = [0.0, 0.0, 0.0]
        normal[axis] = 1.0
        half = trimesh.intersections.slice_mesh_plane(
            mesh,
            plane_normal=np.array(normal),
            plane_origin=np.array(center),
            cap=True,
        )
        if half is None or len(half.faces) == 0:
            return None
        # Look along the cut normal so the exposed section faces the camera.
        azim = -90.0 if axis == 0 else 0.0
        return _render(half, elev=12, azim=azim, figsize=_SMALL_FIGSIZE)
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Session mode (MTR-177 / docs/text-to-cad/03 §A): a persistent child process
# holding ONE Python namespace across execs, so the agentic loop can build a
# part incrementally. Protocol pinned by lib/cad/session-client.ts.
# ---------------------------------------------------------------------------


def _session_namespace_summary(ns: dict) -> list:
    """Non-dunder variable names, so the agent can see what it has defined."""
    return sorted(
        k for k in ns if not (k.startswith("__") and k.endswith("__"))
    )


def _session_import_step_reply(ns: dict, msg: dict, engine: str) -> dict:
    """Bind an imported STEP part into the session namespace (MTR-200).

    Writes the base64 STEP to a temp file and imports it with build123d
    `import_step` (or cadquery's importers), binding it to `name` so generated
    code can boolean/cavity/mate against it. Returns the imported part's
    bounding box (mm) so the caller can DERIVE MATING FRAMES from inspected
    geometry — imported origins are arbitrary (step.parts' explicit warning),
    so callers must never assume the STEP sits at the world origin.

    OCP/build123d only exist in the container image, so this path is
    DOCKER-VERIFIED; any failure is returned as an error reply, never a crash."""
    name = str(msg.get("name") or "part")
    if not name.isidentifier():
        return {"ok": False, "error": f"invalid namespace name {name!r}"}
    step_b64 = msg.get("stepB64")
    if not step_b64:
        return {"ok": False, "error": "no stepB64 provided"}
    tmp_path = None
    try:
        raw = base64.b64decode(step_b64)
        fd, tmp_path = tempfile.mkstemp(suffix=".step")
        with os.fdopen(fd, "wb") as f:
            f.write(raw)

        if engine == "cadquery":
            import cadquery as cq  # noqa: F401

            solid = cq.importers.importStep(tmp_path)
        else:
            from build123d import import_step  # type: ignore

            solid = import_step(tmp_path)
        ns[name] = solid

        bbox = None
        try:
            bb = solid.bounding_box()  # build123d BoundBox
            lo, hi = bb.min, bb.max
            bbox = {
                "min": [float(lo.X), float(lo.Y), float(lo.Z)],
                "max": [float(hi.X), float(hi.Y), float(hi.Z)],
                "size": [
                    float(hi.X - lo.X),
                    float(hi.Y - lo.Y),
                    float(hi.Z - lo.Z),
                ],
            }
        except Exception:  # noqa: BLE001 — bbox is advisory
            bbox = None

        return {
            "ok": True,
            "name": name,
            "byteSize": len(raw),
            "boundingBox": bbox,
            "namespace": _session_namespace_summary(ns),
        }
    except Exception as err:  # noqa: BLE001 — keep the session alive
        return {"ok": False, "error": f"import_step: {err}"}
    finally:
        if tmp_path is not None:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _session_exec_reply(
    ns: dict, msg: dict, engine: str
) -> dict:
    """Run one exec in the persistent namespace and shape the reply.

    stdout is captured per-exec. If `result` or `parts` is present in the
    namespace afterwards (assigned now or by an earlier step — presence, not
    assignment, is the trigger so a rollback re-exports), the reply is the
    full /run payload plus stdout/namespace; otherwise the plain
    {ok, stdout, namespace} triple. A code exception replies in the /run
    shape (compiled=false + error) so the agent repairs it like any failure.
    """
    # Same pre-exec source guard as /run (MTR-187). Session children are
    # long-lived, so an egress import here is exactly the extended-dwell risk
    # the guard is cheapest against. Reply in the /run shape so the agent
    # treats a rejection like any other failed exec.
    reason = _pre_exec_reason(msg["code"])
    if reason is not None:
        reply = _base_payload()
        reply["error"] = f"rejected before execution: {reason}"
        reply["stdout"] = ""
        reply["namespace"] = _session_namespace_summary(ns)
        return reply

    # Feature-chip hooks (same as /run). Idempotent across session execs.
    try:
        from features import ensure_feature_hooks

        ensure_feature_hooks(engine, msg.get("code") or "")
    except Exception:  # noqa: BLE001
        pass

    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(msg["code"], "<session>", "exec"), ns, ns)  # noqa: S102
    except Exception as err:  # noqa: BLE001
        reply = _base_payload()
        reply["error"] = str(err)
        reply["stdout"] = buf.getvalue()
        reply["namespace"] = _session_namespace_summary(ns)
        return reply

    has_shape = ns.get("result") is not None or (
        isinstance(ns.get("parts"), dict) and ns.get("parts")
    )
    if has_shape:
        payload = _build_run_payload(
            ns,
            msg.get("formats") or ["stl", "step", "topo"],
            engine,
            bool(msg.get("allowRemesh")),
            msg.get("checks"),
        )
        payload["stdout"] = buf.getvalue()
        payload["namespace"] = _session_namespace_summary(ns)
        return payload

    reply = {
        "ok": True,
        "stdout": buf.getvalue(),
        "namespace": _session_namespace_summary(ns),
    }
    # Ops recorded by a run-less exec (e.g. `Hole` in a sketch-only setup
    # step) would otherwise be wiped by the next exec's hook reset before any
    # payload ever reported them. No shape/topo yet → params + spans only,
    # faceIds empty; the Node loop accumulates these across the session.
    try:
        from features import finalize_features

        feats = finalize_features(None, None)
        if feats:
            reply["features"] = feats
    except Exception:  # noqa: BLE001
        pass
    return reply


def _session_worker(
    inq: "mp.Queue", outq: "mp.Queue", engine: str, tmpdir: Optional[str] = None
) -> None:
    """Session child: REPL loop over the input/output queues, one persistent
    namespace for the session's lifetime. The parent enforces the per-exec
    wall clock and kills us on breach — no self-timeouts here."""
    # Point this session's temp allocations at its own private 0700 directory
    # (MTR-187): the harness export TemporaryDirectory AND any `tempfile.*` the
    # generated code calls now land under here, and the parent rmtree's the tree
    # on session close, so a later session cannot read this one's temp files.
    # (Same-uid concurrent peers are NOT isolated by this — see README residual
    # risks; that needs distinct uids / a namespace, the gVisor gate.)
    if tmpdir:
        os.environ["TMPDIR"] = tmpdir
        tempfile.tempdir = tmpdir
    _apply_limits(session=True)
    try:
        _warm_engine(engine)
    except Exception:  # noqa: BLE001 — surfaces on first exec's own imports
        pass
    # Lock down once, AFTER the trusted warm — every exec in this session runs
    # under it (MTR-187): scrub secrets, then block egress/spawn.
    _scrub_child_env()
    _install_exec_guard()

    ns: dict = {}
    exec_count = 0
    output_bytes = 0
    while True:
        try:
            msg = inq.get()
        except (EOFError, KeyboardInterrupt):
            break
        op = msg.get("op")
        if op == "shutdown":
            break
        if op == "exec":
            # Per-session exec-count cap (MTR-187): refuse past the budget and
            # end the session, so a long-lived child can't run unbounded execs.
            exec_count += 1
            if exec_count > SESSION_MAX_EXECS:
                _obs("session_budget_exhausted", kind="execs",
                     execs=exec_count, cap=SESSION_MAX_EXECS)
                reply = _base_payload()
                reply["error"] = (
                    f"session exec budget exhausted (>{SESSION_MAX_EXECS} "
                    "execs); start a new session"
                )
                reply["stdout"] = ""
                reply["namespace"] = _session_namespace_summary(ns)
                outq.put(reply)
                break
            _extend_cpu_budget()
            try:
                reply = _session_exec_reply(ns, msg, engine)
            except Exception as err:  # noqa: BLE001 — keep the session alive
                reply = _base_payload()
                reply["error"] = str(err)
                reply["stdout"] = ""
                reply["namespace"] = _session_namespace_summary(ns)
            outq.put(reply)
            # Per-session cumulative output cap (MTR-187): reply is already sent
            # (this exec's result is honored), but if the session has now shipped
            # more than its total output budget, end it — the parent 410s the
            # next call.
            try:
                output_bytes += _reply_output_bytes(reply)
            except Exception:  # noqa: BLE001
                pass
            if output_bytes > SESSION_MAX_OUTPUT_BYTES:
                _obs("session_budget_exhausted", kind="output",
                     bytes=output_bytes, cap=SESSION_MAX_OUTPUT_BYTES)
                break
        elif op == "import_step":
            # Off-the-shelf part sourcing (MTR-200): load a fetched STEP into the
            # session namespace so generated code can reference the component
            # solid for boolean/cavity/mate operations. Exercised only in the
            # container image (needs OCP/build123d import_step) — DOCKER-VERIFIED;
            # failure-isolated so a missing kernel never kills the session.
            outq.put(_session_import_step_reply(ns, msg, engine))
        elif op == "snapshot":
            # Checkpoint the current `result` in-namespace (docs 03 §A v1).
            # Copy so later in-place mutation of `result` (trimesh methods
            # mutate) can't silently corrupt the checkpoint.
            result = ns.get("result")
            if result is None:
                outq.put({"ok": False})
            else:
                try:
                    ns["_checkpoint"] = result.copy()
                except Exception:  # noqa: BLE001 — B-rep objects may lack copy
                    ns["_checkpoint"] = result
                outq.put({"ok": True})
        elif op == "rollback":
            if "_checkpoint" in ns:
                checkpoint = ns["_checkpoint"]
                try:
                    # Restore a copy so the checkpoint survives repeat rollbacks.
                    ns["result"] = checkpoint.copy()
                except Exception:  # noqa: BLE001
                    ns["result"] = checkpoint
                outq.put({"ok": True})
            else:
                outq.put({"ok": False})
        else:
            outq.put({"ok": False, "error": f"unknown op {op!r}"})


class _Session:
    """Parent-side handle: the child process, its queues, and liveness."""

    def __init__(self, engine: str) -> None:
        self.engine = engine
        ctx = mp.get_context("spawn")
        self.inq: "mp.Queue" = ctx.Queue()
        self.outq: "mp.Queue" = ctx.Queue()
        # Private per-session temp root (0700), removed on close so a later
        # session can't read this one's temp files (MTR-187 cross-session
        # cleanup). The child points TMPDIR + tempfile.tempdir at it.
        self.tmpdir = tempfile.mkdtemp(prefix="cadsess-")
        # daemon: a dying uvicorn must not be held open by idle sessions.
        self.proc = ctx.Process(
            target=_session_worker,
            args=(self.inq, self.outq, engine, self.tmpdir),
            daemon=True,
        )
        self.proc.start()
        self.lock = threading.Lock()
        self.last_used = time.monotonic()
        self.dead = False

    def request(self, msg: dict, timeout_s: float):
        """Send one op and wait for its reply. Returns (reply, failure) where
        failure is None | "timeout" | "crash". On failure the child is killed
        and the session marked dead (subsequent calls → HTTP 410)."""
        self.last_used = time.monotonic()
        self.inq.put(msg)
        # Same read-before-join pattern as /run: the reply (base64 STL/PNGs)
        # can exceed the pipe buffer, so drain the queue while the child is
        # still alive, polling so a crash is detected promptly.
        deadline = time.monotonic() + timeout_s
        failure: Optional[str] = None
        while True:
            try:
                reply = self.outq.get(timeout=0.25)
                self.last_used = time.monotonic()
                return reply, None
            except queue_mod.Empty:
                if not self.proc.is_alive():
                    failure = "crash"
                    break
                if time.monotonic() >= deadline:
                    failure = "timeout"
                    break
        self.close()
        return None, failure

    def close(self) -> None:
        self.dead = True
        try:
            if self.proc.is_alive():
                self.proc.terminate()
                self.proc.join(5)
                if self.proc.is_alive():
                    self.proc.kill()
            self.proc.join(1)
        except Exception:  # noqa: BLE001
            pass
        # Remove this session's private temp tree (MTR-187): its export dirs and
        # any files the generated code wrote under TMPDIR go with it, so a later
        # session cannot read them.
        try:
            shutil.rmtree(self.tmpdir, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


_sessions: dict = {}
_sessions_lock = threading.Lock()


def _sweep_sessions() -> None:
    """Lazy TTL sweep, called on every session endpoint hit — single-worker
    simplicity, no background reaper thread. Dead sessions linger as
    tombstones (so callers get an honest 410, not 404) until their TTL lapses."""
    now = time.monotonic()
    with _sessions_lock:
        expired = [
            sid for sid, s in _sessions.items()
            if now - s.last_used > SESSION_TTL_S
        ]
        closing = [_sessions.pop(sid) for sid in expired]
    for sid, s in zip(expired, closing):
        _obs("session_expired", sid=sid, ttlS=SESSION_TTL_S)
        s.close()


def _get_session(session_id: str) -> _Session:
    _sweep_sessions()
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown session")
    if session.dead:
        raise HTTPException(
            status_code=410, detail="session terminated (timeout or crash)"
        )
    return session


# Session endpoints are sync `def` on purpose: FastAPI runs them on the
# threadpool, so the blocking queue wait doesn't stall the event loop (and
# /health) the way it would in an `async def`.


@app.post("/session")
def create_session(req: SessionCreateRequest, request: Request) -> dict:
    _check_auth(request)
    _sweep_sessions()
    with _sessions_lock:
        alive = sum(1 for s in _sessions.values() if not s.dead)
        if alive >= SESSION_MAX:
            raise HTTPException(
                status_code=429,
                detail=f"session cap reached ({SESSION_MAX}); "
                "delete a session or retry later",
            )
        session_id = uuid.uuid4().hex
        _sessions[session_id] = _Session(req.engine)
    _obs("session_created", sid=session_id, engine=req.engine)
    return {"sessionId": session_id}


@app.post("/session/{session_id}/exec")
def session_exec(
    session_id: str, req: SessionExecRequest, request: Request
) -> dict:
    _check_auth(request)
    session = _get_session(session_id)
    t0 = time.monotonic()
    with session.lock:
        if session.dead:  # lost a race with a concurrent failing call
            raise HTTPException(status_code=410, detail="session terminated")
        reply, failure = session.request(
            {
                "op": "exec",
                "code": req.code,
                "formats": req.formats,
                "allowRemesh": req.allowRemesh,
                "checks": req.checks,
            },
            RUN_TIMEOUT_S,
        )
    ms = int((time.monotonic() - t0) * 1000)
    if reply is not None:
        _obs(
            "exec_done",
            sid=session_id,
            ok=bool(reply.get("ok")),
            ms=ms,
            error=reply.get("error"),
            networksIsolated=(
                (reply.get("checks") or {}).get("networks") or {}
            ).get("isolated"),
        )
        return reply
    # The child is gone (killed on timeout, or crashed/OOMed). This exec
    # reports in the /run error shape; the session is dead — later calls 410.
    # The kill reason is the single most useful diagnostic when a generation
    # "just fails": timeout = the exec outran RUN_TIMEOUT_S; crash = OOM,
    # SIGKILL from the session CPU budget, or a sidecar restart.
    _obs(
        "session_killed",
        sid=session_id,
        reason=failure or "crash",
        ms=ms,
        timeoutS=RUN_TIMEOUT_S,
    )
    payload = _base_payload()
    payload["error"] = (
        f"timed out after {RUN_TIMEOUT_S}s"
        if failure == "timeout"
        else "worker produced no result (likely OOM/crash)"
    )
    payload["stdout"] = ""
    payload["namespace"] = []
    return payload


@app.post("/session/{session_id}/import_step")
def session_import_step(
    session_id: str, req: SessionImportStepRequest, request: Request
) -> dict:
    """Bind a fetched STEP into the session namespace (MTR-200). DOCKER-VERIFIED
    (needs OCP/build123d import_step); returns the imported part's bounding box
    so the caller derives mating frames from geometry, not the arbitrary STEP
    origin."""
    _check_auth(request)
    session = _get_session(session_id)
    with session.lock:
        if session.dead:
            raise HTTPException(status_code=410, detail="session terminated")
        reply, failure = session.request(
            {"op": "import_step", "stepB64": req.stepB64, "name": req.name},
            RUN_TIMEOUT_S,
        )
    if reply is None:
        raise HTTPException(
            status_code=410,
            detail=f"session terminated ({failure or 'crash'})",
        )
    return reply


@app.post("/session/{session_id}/snapshot")
def session_snapshot(session_id: str, request: Request) -> dict:
    _check_auth(request)
    session = _get_session(session_id)
    with session.lock:
        if session.dead:
            raise HTTPException(status_code=410, detail="session terminated")
        reply, _failure = session.request({"op": "snapshot"}, RUN_TIMEOUT_S)
    if reply is None:
        raise HTTPException(status_code=410, detail="session terminated")
    return reply


@app.post("/session/{session_id}/rollback")
def session_rollback(session_id: str, request: Request) -> dict:
    _check_auth(request)
    session = _get_session(session_id)
    with session.lock:
        if session.dead:
            raise HTTPException(status_code=410, detail="session terminated")
        reply, _failure = session.request({"op": "rollback"}, RUN_TIMEOUT_S)
    if reply is None:
        raise HTTPException(status_code=410, detail="session terminated")
    return reply


@app.delete("/session/{session_id}")
def session_delete(session_id: str, request: Request) -> dict:
    _check_auth(request)
    _sweep_sessions()
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown session")
    session.close()
    return {"ok": True}


# Sync `def` on purpose, same as the session endpoints above (see the
# comment at their definition): FastAPI runs a sync path op on the
# threadpool, so the blocking `out.get(timeout=...)` poll loop below doesn't
# stall the event loop (and /health) the way it did as `async def` (CAD-10).
@app.post("/run")
def run(req: RunRequest, request: Request) -> dict:
    _check_auth(request)
    t0 = time.monotonic()

    ctx = mp.get_context("spawn")
    out: "mp.Queue" = ctx.Queue()
    proc = ctx.Process(
        target=_execute,
        args=(req.code, req.formats, out, req.engine, req.allowRemesh, req.checks),
    )
    proc.start()

    # Read the result BEFORE joining. The child's payload (STL + STEP, both
    # base64) routinely exceeds the OS pipe buffer (~64 KB), and a
    # multiprocessing.Queue.put() that large only completes once a reader
    # drains the pipe. Joining first deadlocks the child on its feeder thread,
    # which then looks like a wall-clock timeout for any non-trivial model
    # (a small box squeaks under the buffer and hides the bug). See the
    # multiprocessing docs: "Joining processes that use queues". We poll so
    # that a child which crashes/OOMs without producing output is detected
    # promptly instead of always burning the full timeout budget.
    deadline = time.monotonic() + RUN_TIMEOUT_S
    payload: Optional[dict] = None
    # Record WHY we stopped at the moment we decide, not afterward: reading
    # liveness after the loop races a child that dies in the gap and would
    # mislabel a real timeout as a crash.
    timed_out = False
    while True:
        try:
            payload = out.get(timeout=0.25)
            break
        except queue_mod.Empty:
            if not proc.is_alive():
                # Exited without putting a result — crash/OOM/segfault.
                break
            if time.monotonic() >= deadline:
                # Still running past the budget — a genuine hang.
                timed_out = True
                break

    # SIGTERM, then escalate to SIGKILL if the child ignores it (a
    # build123d/OCC C-extension thread can swallow SIGTERM). Never join()
    # without a timeout — that would hang the worker forever.
    if proc.is_alive():
        proc.terminate()
        proc.join(5)
        if proc.is_alive():
            proc.kill()
    # Bounded, per the comment above: a bare join() can hang the worker
    # forever if the child wedges past SIGKILL (CAD-10). By this point the
    # process is either already dead (this returns immediately) or was just
    # killed, so 5s is only ever a safety margin, not the expected wait.
    proc.join(5)

    ms = int((time.monotonic() - t0) * 1000)
    if payload is not None:
        _obs(
            "run_done",
            ok=bool(payload.get("ok")),
            ms=ms,
            engine=req.engine,
            error=payload.get("error"),
            faces=(payload.get("geometry") or {}).get("triangleCount"),
            decimated=payload.get("decimatedForExport"),
            networksIsolated=(
                (payload.get("checks") or {}).get("networks") or {}
            ).get("isolated"),
        )
        return payload

    error = (
        f"timed out after {RUN_TIMEOUT_S}s"
        if timed_out
        else "worker produced no result (likely OOM/crash)"
    )
    _obs(
        "run_died",
        reason="timeout" if timed_out else "crash",
        ms=ms,
        engine=req.engine,
        timeoutS=RUN_TIMEOUT_S,
    )
    return {
        "ok": False,
        "files": {},
        "validation": {
            "compiled": False,
            "isSolid": False,
            "isWatertight": False,
            "isManifold": False,
        },
        "error": error,
    }


@app.get("/health")
async def health() -> dict:
    # Deploy-drift detector: Railway stamps the built commit into the env, so
    # /health names the code actually running. "unknown" outside Railway.
    # (2026-08-05 lesson: a "redeploy" that restarts the old image is
    # indistinguishable from a rebuild without this — the prod sidecar sat on
    # a pre-feature-instrumentation image while everyone assumed it was
    # current.)
    return {
        "ok": True,
        "rev": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown")[:12],
        "features_instrumentation": True,
    }
