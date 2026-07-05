"""
Pre-exec source guard for the CAD sidecar (MTR-187, cheap defense-in-depth).

The sidecar runs model-generated Python and the container is the real trust
boundary (see app.py header). This module is NOT a sandbox and does not
pretend to be one: builtins (`__import__`, `getattr`, `open`, `eval`) stay
reachable inside the exec namespace, so a determined script bypasses every
check here in one line. The gVisor / seccomp / microVM decision (the actual
gate before non-owner access) is tracked separately in MTR-187 and remains
open.

What this DOES buy, independent of that decision, adopting the contract the
CAD-Skills research (docs/text-to-cad/09) uses at their exec boundary:

  1. Parse before fork/exec. A syntactically invalid script is rejected with
     a clean message before we spend a child process on it.
  2. Reject the obvious egress / process-spawn imports at parse time. A lazy
     `import socket` / `import subprocess` / `import requests` in generated
     code fails loudly and cheaply instead of reaching the interpreter. Real
     CAD scripts never import these; the CAD stack's legit import tail is long
     and evolving (build123d, cadquery, trimesh, numpy, scipy, sdf_kit, OCP,
     matplotlib, math, random, ...), so this is a tight DENYLIST, never an
     allowlist that would false-positive on every new dependency.

Source hashing (`source_hash`) is exposed for the same research's
source-hash caching idea — skip re-execution when the generator source is
unchanged. Wiring that into the session worker's exec loop is deferred (it
needs per-session cache state in the hot path app.py owns).

Everything here is pure and importable with only the stdlib, so it runs in
CI without the CAD kernel.
"""

import ast
import hashlib
import os
from typing import Optional

# Top-level module names a generated CAD script never legitimately needs and
# which are the obvious network-egress / process-spawn primitives. Submodules
# are covered by matching the top of the dotted path (e.g. "urllib.request"
# -> "urllib"). Deliberately conservative: only things with no CAD use.
_DENIED_TOP_MODULES = frozenset(
    {
        "socket",
        "ssl",
        "subprocess",
        "multiprocessing",
        "asyncio",
        "asyncore",
        "asynchat",
        "socketserver",
        "requests",
        "urllib",
        "urllib2",
        "http",
        "httplib",
        "ftplib",
        "smtplib",
        "poplib",
        "imaplib",
        "nntplib",
        "telnetlib",
        "xmlrpc",
        "ctypes",
        "pty",
        "webbrowser",
    }
)


def validation_enabled() -> bool:
    """Enforcement kill switch. On by default; set CAD_AST_VALIDATE=false to
    disable without a redeploy if a legitimate script ever trips the denylist
    (the container boundary is unaffected either way)."""
    return os.environ.get("CAD_AST_VALIDATE", "true") != "false"


def _denied_top(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return name.split(".", 1)[0] if name.split(".", 1)[0] in _DENIED_TOP_MODULES else None


def validate_source(code: str) -> Optional[str]:
    """Return a human-readable reason the source must not run, or None if it
    passes. Two checks: it must parse, and it must not statically import a
    denied top-level module. Never raises."""
    try:
        tree = ast.parse(code)
    except SyntaxError as err:
        return f"syntax error: {err.msg} (line {err.lineno})"
    except Exception as err:  # pragma: no cover - defensive
        return f"could not parse source: {err}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _denied_top(alias.name):
                    return f"import of '{alias.name}' is not permitted"
        elif isinstance(node, ast.ImportFrom):
            # `from . import x` has module=None (relative) — ignore.
            if node.level == 0 and _denied_top(node.module):
                return f"import from '{node.module}' is not permitted"
    return None


def source_hash(code: str) -> str:
    """Stable content hash of a generator source, for source-hash caching /
    best-of-N dedup (docs/text-to-cad/09)."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()
