"""
CAD execution sidecar for Materialize text-to-CAD.

A small, isolated HTTP service that runs a generated build123d script and
returns the exported files (STL/STEP), a best-effort preview render,
geometry stats, and validity flags. The Next.js app talks to it via
lib/cad/runner-client.ts.

Output contract: the script must assign its final solid to a variable
named `result` (a build123d object).

SECURITY: this executes model-generated Python. The container is the
trust boundary — deploy it network-disabled, non-root, read-only FS,
with memory/CPU caps (see Dockerfile). Per-run we additionally fork a
child process with resource limits and a wall-clock timeout so a hang or
OOM can't take down the service. Note the `exec` namespace is NOT a
sandbox: builtins (e.g. `__import__`, `os`) remain reachable from
generated code, so a script can run arbitrary Python — the container
boundary, not the namespace, is what contains it. This is adequate for
the owner-only v0; before any public/multi-user exposure, move execution
into a stronger sandbox (gVisor / seccomp / per-run microVM). See the
plan's "out of scope for v0" note.
"""

import base64
import multiprocessing as mp
import os
import queue as queue_mod
import resource
import tempfile
import time
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

app = FastAPI(title="materialize-cad-runner")

# Defaults; override via env in the deployment.
RUN_TIMEOUT_S = int(os.environ.get("CAD_RUN_TIMEOUT_S", "30"))
# RLIMIT_AS caps *virtual* address space, not RSS. Python + build123d +
# OpenCASCADE map well over 1 GB of address space at import time, so a 1 GB
# cap can ENOMEM before user code even runs. Default to 4 GB; the container
# memory limit (Dockerfile) is the real physical-RAM bound.
MEM_LIMIT_BYTES = int(
    os.environ.get("CAD_RUN_MEM_BYTES", str(4 * 1024 * 1024 * 1024))
)
CPU_LIMIT_S = int(os.environ.get("CAD_RUN_CPU_S", "25"))
RUNNER_SECRET = os.environ.get("CAD_RUNNER_SECRET", "")


class RunRequest(BaseModel):
    code: str
    formats: list[str] = ["stl", "step"]


def _apply_limits() -> None:
    """Cap address space + CPU in the child so runaway scripts die fast."""
    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEM_LIMIT_BYTES, MEM_LIMIT_BYTES))
        resource.setrlimit(resource.RLIMIT_CPU, (CPU_LIMIT_S, CPU_LIMIT_S))
    except (ValueError, OSError):
        # Best-effort; the container limits are the real boundary.
        pass


def _process_shape(shape, formats: list[str], tmp: str, stem: str) -> dict:
    """Export + measure + render one solid. Returns the per-part payload
    (files, render, geometry, validity). Shared by the single-`result` path
    and each member of a multi-part `parts` assembly."""
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
    from build123d import export_stl, export_step

    volume = float(getattr(shape, "volume", 0.0) or 0.0)
    entry["validation"]["isSolid"] = volume > 0.0

    stl_path = os.path.join(tmp, f"{stem}.stl")
    export_stl(shape, stl_path)

    # STEP comes straight from the OCC BRep (not the mesh) — keep it as-is.
    if "step" in formats:
        step_path = os.path.join(tmp, f"{stem}.step")
        export_step(shape, step_path)
        with open(step_path, "rb") as f:
            entry["files"]["step"] = base64.b64encode(f.read()).decode()

    try:
        import trimesh
        from trimesh import repair as trimesh_repair

        mesh = trimesh.load(stl_path, force="mesh")

        # Best-effort cleanup so boolean-op artifacts (unwelded verts,
        # degenerate/duplicate faces, flipped winding, small holes) don't
        # hard-fail an otherwise-good model. Each step is independent and
        # optional across trimesh versions; the repaired mesh becomes the
        # printable STL we hand back.
        if not mesh.is_watertight or not mesh.is_winding_consistent:
            for step in (
                lambda: mesh.merge_vertices(),
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
        # so it only runs when the model would otherwise FAIL. Disable with
        # CAD_VOXEL_FALLBACK=false.
        if (
            not mesh.is_watertight
            and os.environ.get("CAD_VOXEL_FALLBACK", "true") != "false"
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

        entry["validation"]["isWatertight"] = bool(mesh.is_watertight)
        entry["validation"]["isManifold"] = bool(mesh.is_winding_consistent)
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
        entry["renderPng"] = _render(mesh)
    except Exception as mesh_err:  # noqa: BLE001
        entry["error"] = f"analysis: {mesh_err}"

    # Encode the (possibly repaired) STL.
    if "stl" in formats:
        with open(stl_path, "rb") as f:
            entry["files"]["stl"] = base64.b64encode(f.read()).decode()

    return entry


def _execute(code: str, formats: list[str], out: "mp.Queue") -> None:
    """Child-process worker: exec the script, export, measure, validate.

    Output contract: the script assigns either `result` (a single solid) OR
    `parts` (a dict {name: solid} for a multi-part assembly). For an assembly
    the top-level fields mirror the first part (so single-part consumers keep
    working) and the full per-part breakdown is returned under `parts`.
    """
    _apply_limits()
    result_payload: dict = {
        "ok": False,
        "files": {},
        "renderPng": None,
        "geometry": None,
        "remeshed": False,
        "validation": {
            "compiled": False,
            "isSolid": False,
            "isWatertight": False,
            "isManifold": False,
        },
        "error": None,
    }
    try:
        import build123d as b3d  # noqa: F401

        ns: dict = {}
        exec(compile(code, "<generated>", "exec"), ns, ns)  # noqa: S102
        result_payload["validation"]["compiled"] = True

        single = ns.get("result")
        parts_ns = ns.get("parts")

        with tempfile.TemporaryDirectory() as tmp:
            if single is not None:
                entry = _process_shape(single, formats, tmp, "model")
                result_payload["files"] = entry["files"]
                result_payload["renderPng"] = entry["renderPng"]
                result_payload["geometry"] = entry["geometry"]
                result_payload["validation"] = entry["validation"]
                result_payload["remeshed"] = bool(entry.get("remeshed"))
                if entry["error"]:
                    result_payload["error"] = entry["error"]
                result_payload["ok"] = entry["validation"]["isSolid"]
            elif isinstance(parts_ns, dict) and parts_ns:
                parts: list[dict] = []
                all_ok = True
                for i, (name, shape) in enumerate(parts_ns.items()):
                    stem = "".join(
                        c if c.isalnum() else "-" for c in str(name)
                    ).strip("-") or f"part{i}"
                    entry = _process_shape(shape, formats, tmp, stem)
                    parts.append({"name": str(name), **entry})
                    all_ok = all_ok and entry["validation"]["isSolid"]
                # Top-level mirrors the first part for single-part consumers.
                first = parts[0]
                result_payload["files"] = first["files"]
                result_payload["renderPng"] = first["renderPng"]
                result_payload["geometry"] = first["geometry"]
                # Aggregate validity = AND across parts.
                result_payload["validation"] = {
                    "compiled": True,
                    "isSolid": all(p["validation"]["isSolid"] for p in parts),
                    "isWatertight": all(
                        p["validation"]["isWatertight"] for p in parts
                    ),
                    "isManifold": all(
                        p["validation"]["isManifold"] for p in parts
                    ),
                }
                result_payload["parts"] = parts
                result_payload["remeshed"] = any(p.get("remeshed") for p in parts)
                result_payload["ok"] = all_ok
            else:
                result_payload["error"] = (
                    "script did not assign `result` or a non-empty `parts` dict"
                )

        out.put(result_payload)
    except Exception as err:  # noqa: BLE001
        result_payload["error"] = str(err)
        out.put(result_payload)


def _render(mesh) -> Optional[str]:
    """Headless clay-style preview PNG (base64).

    Uses matplotlib's Agg backend rather than trimesh's `scene.save_image`,
    which needs a live OpenGL/pyglet context and silently fails headless (on
    macOS dev and most servers) — leaving every render empty. That empty
    render is load-bearing now: the VLM aesthetic judge and the repair loop
    feed on it, so a real (if simple) Lambert-shaded 3/4 view matters more
    than photoreal GL. Returns None on any failure — callers tolerate it."""
    try:
        import io

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

        fig = plt.figure(figsize=(6.4, 4.8), dpi=100)
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
        ax.view_init(elev=22, azim=-55)
        ax.set_axis_off()

        buf = io.BytesIO()
        fig.savefig(
            buf, format="png", bbox_inches="tight", pad_inches=0, transparent=True
        )
        plt.close(fig)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:  # noqa: BLE001
        return None


@app.post("/run")
async def run(req: RunRequest, request: Request) -> dict:
    if RUNNER_SECRET:
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {RUNNER_SECRET}":
            raise HTTPException(status_code=401, detail="unauthorized")

    ctx = mp.get_context("spawn")
    out: "mp.Queue" = ctx.Queue()
    proc = ctx.Process(target=_execute, args=(req.code, req.formats, out))
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
    proc.join()

    if payload is not None:
        return payload

    error = (
        f"timed out after {RUN_TIMEOUT_S}s"
        if timed_out
        else "worker produced no result (likely OOM/crash)"
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
    return {"ok": True}
