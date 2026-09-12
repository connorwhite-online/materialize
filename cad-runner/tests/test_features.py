"""
Unit tests for construction-feature helpers that don't need OCP/build123d.
Run: `python3 cad-runner/tests/test_features.py`
"""

import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from features import (  # noqa: E402
    _extract_source_params,
    _label,
    _local,
    _numeric_from_call,
    _script_lineno,
    _span_for_line,
    _statement_spans,
    clear_features,
    finalize_features,
)


def test_extract_source_params():
    src = """
from build123d import *
wall = 2
fillet_r = 2.4
a, b = 1, 3
# comment
  indented = 9
height = 12
"""
    assert _extract_source_params(src) == {
        "wall": 2.0,
        "fillet_r": 2.4,
        "a": 1.0,
        "b": 3.0,
        "height": 12.0,
    }


def test_numeric_from_call_fillet_positional():
    assert _numeric_from_call((["edges"], 2.4), {}, "fillet") == {
        "radius": 2.4
    }


def test_numeric_from_call_extrude_kw():
    assert _numeric_from_call((), {"amount": 10}, "extrude") == {"amount": 10.0}


def test_label():
    assert _label("fillet", {"radius": 2.4}) == "Fillet r=2.4"
    assert _label("extrude", {"amount": 12}) == "Extrude 12"
    assert _label("hole", {}) == "Hole"


def test_finalize_empty_without_log():
    clear_features()
    assert finalize_features(None, None) == []


SPAN_SRC = """from build123d import *
wall = 2.4
with BuildPart() as p:
    Box(20, 20, 10)
    fillet(
        p.edges().group_by(Axis.Z)[-1],
        3.5,
    )
result = p.part
"""


def test_statement_spans_smallest_enclosing():
    spans = _statement_spans(SPAN_SRC)
    # The multiline fillet call (lines 5-8) resolves to itself, not the
    # enclosing with-block (lines 3-8).
    assert _span_for_line(spans, 6) == [5, 8]
    assert _span_for_line(spans, 4) == [4, 4]
    assert _span_for_line(spans, 2) == [2, 2]
    assert _span_for_line(spans, 99) is None


def test_statement_spans_bad_source_is_empty():
    assert _statement_spans("def broken(:") == []


def test_script_lineno_from_exec_frame():
    captured = []

    def probe():
        captured.append(_script_lineno())

    ns = {"probe": probe}
    exec(compile("x = 1\nprobe()\n", "<generated>", "exec"), ns, ns)  # noqa: S102
    assert captured == [2]


def test_finalize_emits_span_for_logged_line():
    clear_features()
    _local.source = SPAN_SRC
    _local.features = [
        {"op": "fillet", "params": {"radius": 3.5}, "face_hashes": set(), "line": 6},
        # No line recorded → no span, still a feature.
        {"op": "extrude", "params": {"amount": 10}, "face_hashes": set()},
    ]
    feats = finalize_features(None, None)
    assert feats[0]["span"] == [5, 8]
    assert "span" not in feats[1]
    clear_features()


def _runner_dir():
    return Path(__file__).resolve().parents[1]


def _sibling_modules():
    """Top-level module names that exist as .py files beside app.py."""
    return {f.stem for f in _runner_dir().glob("*.py")}


def _dockerfile_shipped():
    """Module names the Dockerfile's COPY lines actually put in the image."""
    import fnmatch

    siblings = _sibling_modules()
    shipped = set()
    for line in (_runner_dir() / "Dockerfile").read_text().splitlines():
        line = line.strip()
        if not line.upper().startswith("COPY "):
            continue
        # Drop the COPY keyword and the destination (last token).
        parts = line.split()[1:]
        for pattern in parts[:-1]:
            if not pattern.endswith(".py"):
                continue
            stem = pattern[:-3]
            shipped |= {m for m in siblings if fnmatch.fnmatch(m, stem)}
    return shipped


def _app_local_imports():
    """Sibling modules app.py imports (top-level or lazily inside a function)."""
    import ast as ast_mod

    siblings = _sibling_modules()
    tree = ast_mod.parse((_runner_dir() / "app.py").read_text())
    found = set()
    for node in ast_mod.walk(tree):
        if isinstance(node, ast_mod.ImportFrom) and node.level == 0 and node.module:
            root = node.module.split(".")[0]
            if root in siblings:
                found.add(root)
        elif isinstance(node, ast_mod.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in siblings:
                    found.add(root)
    return found


def _prompted_imports():
    """Sibling modules the TS prompts tell GENERATED scripts to import.

    These never appear in app.py, so an import-only scan misses them — and a
    missing one fails inside user code as a ModuleNotFoundError that reads
    like a bad generation rather than a bad image.
    """
    import re as re_mod

    siblings = _sibling_modules()
    lib_cad = _runner_dir().parent / "lib" / "cad"
    if not lib_cad.is_dir():
        return set()
    found = set()
    pattern = re_mod.compile(r"from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\b")
    for ts in lib_cad.rglob("*.ts"):
        for name in pattern.findall(ts.read_text(errors="ignore")):
            if name in siblings:
                found.add(name)
    return found


def test_dockerfile_ships_every_module_that_gets_imported():
    """Packaging contract: every sibling module app.py or a generated script
    imports MUST be COPYed into the image.

    This is pinned because it silently broke in production. The COPY list was
    hand-maintained and enumerated five modules; features.py, validate.py and
    exchanger.py were added later and never added to it. Every one of those
    imports sits behind a fail-open `except`, so the image built, booted,
    passed its health check and served generations — while the studio's
    feature chips never rendered (no features.py => no `features` in the run
    payload => `viewedFeatures.length === 0` => the strip returns null) and
    the MTR-187 AST guard was disabled. Nothing anywhere raised.
    """
    shipped = _dockerfile_shipped()
    assert "app" in shipped, "Dockerfile must COPY app.py"

    needed = _app_local_imports() | _prompted_imports()
    # Sanity: the scan has to actually find the known consumers, or a silent
    # scan failure would make this test vacuously pass.
    for expected in ("features", "validate", "fit", "sdf_kit"):
        assert expected in needed, f"import scan missed {expected} — scan is broken"

    missing = sorted(needed - shipped)
    assert not missing, (
        f"modules imported at runtime but never COPYed into the image: {missing}. "
        "They fail open, so this does not crash — it silently disables features."
    )


def test_health_reports_measured_module_presence():
    """/health's module flags must be measured, not asserted.

    `features_instrumentation` was a hardcoded `True` while the deployed image
    had no features.py — the one endpoint meant to catch deploy drift could
    not see the drift. If this regresses to a literal, the detector is dead
    again.
    """
    src = (_runner_dir() / "app.py").read_text()
    assert '"features_instrumentation": True' not in src, (
        "features_instrumentation is hardcoded True again — it must probe the "
        "real import (see _module_status)"
    )
    assert "def _module_status()" in src, "health module probe is gone"


def main() -> int:
    failed = 0
    for name, fn in list(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"ok  {name}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    return 1 if failed else 0


if __name__ == "__main__":
    # Quiet unused-import lint for os in this lean runner.
    _ = os.environ.get("CAD_RUNNER_ALLOW_NO_AUTH")
    raise SystemExit(main())
