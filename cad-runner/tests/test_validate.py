"""
Plain-python tests for the pre-exec source guard (validate.py, MTR-187).
stdlib only — no CAD kernel needed. Run: `python3 cad-runner/tests/test_validate.py`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate import validate_source, source_hash, validation_enabled  # noqa: E402


def test_clean_cad_script_passes():
    code = (
        "import build123d\n"
        "import numpy as np\n"
        "from math import pi\n"
        "from sdf_kit import box, to_mesh\n"
        "result = build123d.Box(1, 2, 3)\n"
    )
    assert validate_source(code) is None, "legit CAD imports must pass"


def test_syntax_error_is_reported():
    reason = validate_source("result = (1 +\n")
    assert reason is not None and "syntax error" in reason, reason


def test_denies_socket():
    reason = validate_source("import socket\nresult = 1\n")
    assert reason is not None and "socket" in reason, reason


def test_denies_subprocess_from_import():
    reason = validate_source("from subprocess import run\nresult = 1\n")
    assert reason is not None and "subprocess" in reason, reason


def test_denies_urllib_submodule():
    reason = validate_source("import urllib.request\nresult = 1\n")
    assert reason is not None and "urllib" in reason, reason


def test_denies_requests():
    reason = validate_source("import requests\nresult = 1\n")
    assert reason is not None and "requests" in reason, reason


def test_allows_os_and_math():
    # os is reachable regardless and legit scripts may touch os.environ; the
    # denylist is egress/process-spawn only, not a blanket stdlib block.
    assert validate_source("import os\nimport math\nresult = 1\n") is None


def test_relative_import_is_ignored():
    # `from . import x` has module=None — must not crash or falsely deny.
    assert validate_source("from . import helpers\nresult = 1\n") is None


def test_source_hash_is_stable_and_sensitive():
    a = source_hash("result = 1\n")
    b = source_hash("result = 1\n")
    c = source_hash("result = 2\n")
    assert a == b and a != c


def test_enabled_by_default(monkeypatch_env):
    monkeypatch_env("CAD_AST_VALIDATE", None)
    assert validation_enabled() is True
    monkeypatch_env("CAD_AST_VALIDATE", "false")
    assert validation_enabled() is False


# --- tiny runner (no pytest in the image) --------------------------------
import os  # noqa: E402


class _EnvPatcher:
    def __init__(self):
        self._saved = {}

    def __call__(self, key, value):
        if key not in self._saved:
            self._saved[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

    def restore(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._saved.clear()


if __name__ == "__main__":
    patcher = _EnvPatcher()
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            if "monkeypatch_env" in fn.__code__.co_varnames:
                fn(patcher)
            else:
                fn()
            print(f"ok   {name}")
        except Exception as err:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {err}")
        finally:
            patcher.restore()
    if failures:
        print(f"\n{failures} failure(s)")
        sys.exit(1)
    print("\nall validate.py tests passed")
