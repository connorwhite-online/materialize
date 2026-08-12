"""
Construction-feature instrumentation for B-rep runs (feature-chip UX).

Wraps common build123d ops before untrusted script exec, records op type +
numeric params + before/after face hashes, then resolves those hashes against
the final topo face map so the studio can highlight + edit features.

Best-effort by contract: any failure here must NEVER break a generation —
hooks no-op when OCP/build123d aren't available (dev/test mesh path), and
finalize returns [] on anything unexpected.
"""

from __future__ import annotations

import ast
import re
import sys
import threading
from typing import Any, Callable, Optional

# Filenames the runner compiles untrusted scripts under (app.py exec sites).
# Stack walking keys on these to find the user-script line for an op call.
_SCRIPT_FILENAMES = ("<generated>", "<session>")

# Per-thread log so concurrent session children don't cross-contaminate.
_local = threading.local()

# Top-level `name = <number>` — mirrors components/cad/param-diff.ts.
_ASSIGN_RE = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)"
    r"\s*=(?!=)\s*"
    r"([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:\s*,\s*"
    r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)*)"
    r"\s*(?:#.*)?$"
)

# build123d public names → our op tag. Algebra + builder modes both land here
# when the script does `from build123d import *` after we patch the module.
_OP_NAMES: dict[str, str] = {
    "fillet": "fillet",
    "chamfer": "chamfer",
    "extrude": "extrude",
    "revolve": "revolve",
    "loft": "loft",
    "offset": "shell",  # shell via offset(amount=-wall, openings=…)
    "Hole": "hole",
    "CounterBoreHole": "hole",
    "CounterSinkHole": "hole",
}


def _log() -> list:
    if not hasattr(_local, "features"):
        _local.features = []
    return _local.features


def _source() -> str:
    return getattr(_local, "source", "") or ""


def clear_features() -> None:
    _local.features = []
    _local.source = ""


def reset_feature_state() -> None:
    """Full reset including patch bookkeeping (new process / new session)."""
    clear_features()
    _local.orig = {}
    _local.installed_engine = None


def _extract_source_params(source: str) -> dict[str, float]:
    params: dict[str, float] = {}
    for line in source.splitlines():
        if line[:1].isspace():
            continue
        m = _ASSIGN_RE.match(line)
        if not m:
            continue
        names = [s.strip() for s in m.group(1).split(",")]
        values_s = [s.strip() for s in m.group(2).split(",")]
        if len(names) != len(values_s):
            continue
        try:
            values = [float(v) for v in values_s]
        except ValueError:
            continue
        for name, value in zip(names, values):
            params[name] = value
    return params


def _numeric_from_call(args: tuple, kwargs: dict, op: str) -> dict[str, float]:
    """Pull the knobs a chip can edit from positional/kw args."""
    out: dict[str, float] = {}
    # Keyword form first (preferred).
    for key in (
        "radius",
        "amount",
        "depth",
        "length",
        "length2",
        "height",
        "angle",
        "thickness",
    ):
        v = kwargs.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[key] = float(v)
    # Common positional conventions.
    if op in ("fillet", "chamfer") and "radius" not in out and "length" not in out:
        # fillet(objects, radius) / chamfer(objects, length)
        if len(args) >= 2 and isinstance(args[1], (int, float)):
            out["radius" if op == "fillet" else "length"] = float(args[1])
    if op == "extrude" and "amount" not in out:
        # extrude(to_extrude, amount) OR extrude(amount) in builder mode
        for a in args:
            if isinstance(a, (int, float)) and not isinstance(a, bool):
                out["amount"] = float(a)
                break
    if op == "hole":
        # Hole(radius, depth) — both positional
        if "radius" not in out and len(args) >= 1 and isinstance(args[0], (int, float)):
            out["radius"] = float(args[0])
        if "depth" not in out and len(args) >= 2 and isinstance(args[1], (int, float)):
            out["depth"] = float(args[1])
    if op == "shell" and "amount" not in out:
        if len(args) >= 1 and isinstance(args[0], (int, float)):
            out["amount"] = float(args[0])
    return out


def _current_solid():
    """Best-effort: the solid under the active BuildPart, if any."""
    try:
        from build123d.build_common import Builder  # type: ignore

        ctx = Builder._get_context()  # noqa: SLF001 — public-enough stack API
        if ctx is None:
            return None
        part = getattr(ctx, "part", None)
        return part
    except Exception:  # noqa: BLE001
        return None


def _face_hashes(shape) -> set[int]:
    if shape is None:
        return set()
    try:
        from OCP.TopAbs import TopAbs_FACE  # type: ignore
        from OCP.TopExp import TopExp  # type: ignore
        from OCP.TopTools import TopTools_IndexedMapOfShape  # type: ignore

        topo = getattr(shape, "wrapped", None)
        if topo is None and hasattr(shape, "val"):
            topo = shape.val().wrapped
        if topo is None:
            return set()
        face_map = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(topo, TopAbs_FACE, face_map)
        out: set[int] = set()
        for i in range(1, face_map.Extent() + 1):
            face = face_map.FindKey(i)
            out.add(int(face.HashCode(2147483647)))
        return out
    except Exception:  # noqa: BLE001
        return set()


def _hash_to_face_id(shape) -> dict[int, int]:
    """Same face iteration order as `_export_topology` (1-based map → id-1)."""
    mapping: dict[int, int] = {}
    if shape is None:
        return mapping
    try:
        from OCP.TopAbs import TopAbs_FACE  # type: ignore
        from OCP.TopExp import TopExp  # type: ignore
        from OCP.TopTools import TopTools_IndexedMapOfShape  # type: ignore

        topo = getattr(shape, "wrapped", None)
        if topo is None and hasattr(shape, "val"):
            topo = shape.val().wrapped
        if topo is None:
            return mapping
        face_map = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(topo, TopAbs_FACE, face_map)
        for i in range(1, face_map.Extent() + 1):
            face = face_map.FindKey(i)
            mapping[int(face.HashCode(2147483647))] = i - 1
        return mapping
    except Exception:  # noqa: BLE001
        return mapping


def _label(op: str, params: dict[str, float]) -> str:
    pretty = {
        "fillet": "Fillet",
        "chamfer": "Chamfer",
        "extrude": "Extrude",
        "revolve": "Revolve",
        "loft": "Loft",
        "shell": "Shell",
        "hole": "Hole",
        "boolean": "Boolean",
        "other": "Feature",
    }.get(op, op.title())
    if not params:
        return pretty
    # Prefer the most recognizable knob in the label.
    for key, suffix in (
        ("radius", "r"),
        ("length", "l"),
        ("amount", ""),
        ("depth", "d"),
        ("angle", "°"),
        ("thickness", "t"),
    ):
        if key in params:
            n = params[key]
            lit = f"{n:g}"
            if key == "amount":
                return f"{pretty} {lit}"
            if key == "angle":
                return f"{pretty} {lit}{suffix}"
            return f"{pretty} {suffix}={lit}"
    # Fallback: first param.
    k, v = next(iter(params.items()))
    return f"{pretty} {k}={v:g}"


def _script_lineno() -> Optional[int]:
    """Line in the exec'd user script that (transitively) made this call.

    Walks outward from the current frame to the deepest frame whose filename
    is one of the runner's script exec names — i.e. the user's own statement,
    not build123d internals. Best-effort: None when not found.
    """
    try:
        frame = sys._getframe(2)  # noqa: SLF001 — skip wrapped() + this helper
        while frame is not None:
            if frame.f_code.co_filename in _SCRIPT_FILENAMES:
                return int(frame.f_lineno)
            frame = frame.f_back
    except Exception:  # noqa: BLE001
        pass
    return None


def _wrap_callable(original: Callable, op: str) -> Callable:
    def wrapped(*args, **kwargs):
        before = _face_hashes(_current_solid())
        result = original(*args, **kwargs)
        after_solid = _current_solid()
        # Algebra-mode ops often return the new solid directly.
        if after_solid is None and result is not None:
            after_solid = result
        after = _face_hashes(after_solid)
        new_faces = after - before
        params = _numeric_from_call(args, kwargs, op)
        _log().append(
            {
                "op": op,
                "params": params,
                "face_hashes": new_faces,
                "line": _script_lineno(),
            }
        )
        return result

    wrapped.__name__ = getattr(original, "__name__", op)
    wrapped.__doc__ = getattr(original, "__doc__", None)
    return wrapped


def _wrap_hole_class(cls, op: str = "hole"):
    """Hole/CounterBoreHole are classes used as `Hole(r, depth)` in a sketch."""
    # Idempotent: session children re-enter ensure_feature_hooks every exec.
    if getattr(cls, "_mz_feature_wrapped", False):
        return cls
    orig_init = cls.__init__

    def new_init(self, *args, **kwargs):
        params = _numeric_from_call(args, kwargs, op)
        # Face hashes aren't meaningful mid-sketch — leave empty; finalize
        # still emits the chip so radius/depth are editable when bound.
        _log().append(
            {
                "op": op,
                "params": params,
                "face_hashes": set(),
                "line": _script_lineno(),
            }
        )
        return orig_init(self, *args, **kwargs)

    cls.__init__ = new_init
    cls._mz_feature_wrapped = True  # type: ignore[attr-defined]
    return cls


def ensure_feature_hooks(engine: str, source: str = "") -> None:
    """Install build123d op patches once per process/engine; refresh the log.

    Session children call this every exec — only the feature log + source are
    reset after the first install so Hole.__init__ wrappers don't stack.

    The per-exec reset is the PROTOCOL, not an accident: each exec's reply
    reports only its own ops, with spans relative to its own code, and the
    Node agentic loop rebases + accumulates them across the session
    (lib/cad/agentic.ts). Accumulating here instead would double-count every
    op and break span resolution (lines from earlier execs don't exist in
    the current `_local.source`).
    """
    _local.features = []
    _local.source = source or ""
    if engine != "build123d":
        return
    if getattr(_local, "installed_engine", None) == engine:
        return
    try:
        import build123d as b3d  # type: ignore
    except Exception:  # noqa: BLE001
        return

    orig: dict[str, Any] = {}
    for name, op in _OP_NAMES.items():
        if not hasattr(b3d, name):
            continue
        target = getattr(b3d, name)
        orig[name] = target
        try:
            if name in ("Hole", "CounterBoreHole", "CounterSinkHole") and isinstance(
                target, type
            ):
                _wrap_hole_class(target, op)
            elif callable(target) and not getattr(target, "_mz_feature_wrapped", False):
                wrapped = _wrap_callable(target, op)
                wrapped._mz_feature_wrapped = True  # type: ignore[attr-defined]
                setattr(b3d, name, wrapped)
        except Exception:  # noqa: BLE001 — never break generation
            continue
    _local.orig = orig
    _local.installed_engine = engine


# Back-compat alias used by older call sites / tests.
install_feature_hooks = ensure_feature_hooks


def _statement_spans(source: str) -> list[tuple[int, int]]:
    """(lineno, end_lineno) for every statement node, innermost usable last.

    Sorted by ascending span size so the FIRST hit when scanning for a line is
    the smallest enclosing statement — the fillet() line inside a `with
    BuildPart(...)` block, not the whole with-block.
    """
    try:
        tree = ast.parse(source)
    except Exception:  # noqa: BLE001 — span resolution is best-effort
        return []
    spans: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.stmt):
            end = getattr(node, "end_lineno", None) or node.lineno
            spans.append((int(node.lineno), int(end)))
    spans.sort(key=lambda s: (s[1] - s[0], s[0]))
    return spans


def _span_for_line(spans: list[tuple[int, int]], line: int) -> Optional[list[int]]:
    for start, end in spans:
        if start <= line <= end:
            return [start, end]
    return None


def finalize_features(shape, topo: Optional[dict] = None) -> list[dict]:
    """Resolve recorded ops → CadFeature dicts aligned with topo face ids."""
    raw = list(_log())
    if not raw:
        return []
    try:
        hash_to_id = _hash_to_face_id(shape)
        source_params = _extract_source_params(_source())
        stmt_spans = _statement_spans(_source())
        by_value: dict[float, list[str]] = {}
        for name, value in source_params.items():
            by_value.setdefault(value, []).append(name)

        # Optional: restrict faceIds to ids that exist in topo.
        valid_ids: Optional[set[int]] = None
        if isinstance(topo, dict) and isinstance(topo.get("faces"), list):
            valid_ids = {
                int(f["id"])
                for f in topo["faces"]
                if isinstance(f, dict) and isinstance(f.get("id"), int)
            }

        counts: dict[str, int] = {}
        features: list[dict] = []
        for entry in raw:
            op = entry.get("op") or "other"
            params = {
                k: float(v)
                for k, v in (entry.get("params") or {}).items()
                if isinstance(v, (int, float))
            }
            face_ids = sorted(
                {
                    hash_to_id[h]
                    for h in (entry.get("face_hashes") or set())
                    if h in hash_to_id
                }
            )
            if valid_ids is not None:
                face_ids = [i for i in face_ids if i in valid_ids]

            param_names: dict[str, str] = {}
            for key, value in params.items():
                names = by_value.get(value) or []
                if len(names) == 1:
                    param_names[key] = names[0]

            idx = counts.get(op, 0)
            counts[op] = idx + 1
            feat = {
                "id": f"{op}-{idx}",
                "op": op,
                "label": _label(op, params),
                "params": params,
                "faceIds": face_ids,
            }
            if param_names:
                feat["paramNames"] = param_names
            line = entry.get("line")
            if isinstance(line, int) and line > 0:
                span = _span_for_line(stmt_spans, line)
                if span:
                    feat["span"] = span
            features.append(feat)
        return features
    except Exception:  # noqa: BLE001
        return []
