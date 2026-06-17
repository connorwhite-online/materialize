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
import resource
import tempfile
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


def _execute(code: str, formats: list[str], out: "mp.Queue") -> None:
    """Child-process worker: exec the script, export, measure, validate."""
    _apply_limits()
    result_payload: dict = {
        "ok": False,
        "files": {},
        "renderPng": None,
        "geometry": None,
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
        from build123d import export_stl, export_step

        ns: dict = {}
        exec(compile(code, "<generated>", "exec"), ns, ns)  # noqa: S102
        result_payload["validation"]["compiled"] = True

        shape = ns.get("result")
        if shape is None:
            result_payload["error"] = "script did not assign `result`"
            out.put(result_payload)
            return

        volume = float(getattr(shape, "volume", 0.0) or 0.0)
        is_solid = volume > 0.0
        result_payload["validation"]["isSolid"] = is_solid

        with tempfile.TemporaryDirectory() as tmp:
            stl_path = os.path.join(tmp, "model.stl")
            # Always export STL — we need it for printing + analysis.
            export_stl(shape, stl_path)
            if "stl" in formats:
                with open(stl_path, "rb") as f:
                    result_payload["files"]["stl"] = base64.b64encode(
                        f.read()
                    ).decode()
            if "step" in formats:
                step_path = os.path.join(tmp, "model.step")
                export_step(shape, step_path)
                with open(step_path, "rb") as f:
                    result_payload["files"]["step"] = base64.b64encode(
                        f.read()
                    ).decode()

            # Mesh-level checks + stats + best-effort render via trimesh.
            try:
                import trimesh

                mesh = trimesh.load(stl_path, force="mesh")
                result_payload["validation"]["isWatertight"] = bool(
                    mesh.is_watertight
                )
                result_payload["validation"]["isManifold"] = bool(
                    mesh.is_winding_consistent
                )
                ext = mesh.extents
                result_payload["geometry"] = {
                    "dimensions": {
                        "x": float(ext[0]),
                        "y": float(ext[1]),
                        "z": float(ext[2]),
                    },
                    "volume": float(mesh.volume),
                    "triangleCount": int(len(mesh.faces)),
                }
                result_payload["renderPng"] = _render(mesh)
            except Exception as mesh_err:  # noqa: BLE001
                # Export succeeded but analysis failed — still a usable model.
                result_payload["error"] = f"analysis: {mesh_err}"

        result_payload["ok"] = (
            is_solid and result_payload["validation"]["compiled"]
        )
        out.put(result_payload)
    except Exception as err:  # noqa: BLE001
        result_payload["error"] = str(err)
        out.put(result_payload)


def _render(mesh) -> Optional[str]:
    """Best-effort offscreen PNG (base64). Returns None where headless GL
    isn't available — the UI tolerates a missing render."""
    try:
        scene = mesh.scene()
        png = scene.save_image(resolution=(640, 480))
        return base64.b64encode(png).decode()
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
    proc.join(RUN_TIMEOUT_S)

    if proc.is_alive():
        # SIGTERM, then escalate to SIGKILL if the child ignores it (a
        # build123d/OCC C-extension thread can swallow SIGTERM). Never
        # join() without a timeout — that would hang the worker forever.
        proc.terminate()
        proc.join(5)
        if proc.is_alive():
            proc.kill()
            proc.join()
        return {
            "ok": False,
            "files": {},
            "validation": {
                "compiled": False,
                "isSolid": False,
                "isWatertight": False,
                "isManifold": False,
            },
            "error": f"timed out after {RUN_TIMEOUT_S}s",
        }

    try:
        return out.get_nowait()
    except Exception:  # noqa: BLE001
        return {
            "ok": False,
            "files": {},
            "validation": {
                "compiled": False,
                "isSolid": False,
                "isWatertight": False,
                "isManifold": False,
            },
            "error": "worker produced no result (likely OOM/crash)",
        }


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
