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
