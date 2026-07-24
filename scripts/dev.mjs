#!/usr/bin/env node
/**
 * `npm run dev` = Next dev server + the CAD sidecar, one command.
 *
 * The Prometheus text-to-CAD studio needs the Python sidecar
 * (cad-runner/, uvicorn on :8000) or every generation fails with
 * "CAD sessions unavailable". It was previously a hand-started side
 * terminal — easy to forget, and the failure mode looks like an app bug.
 *
 * Degrades gracefully:
 *  - no cad-runner/.venv        -> Next only, with a setup hint
 *  - port already serving       -> Next only, reuses the running sidecar
 *  - CAD_DEV_SIDECAR=false      -> Next only, explicit opt-out
 *
 * The sidecar runs with CAD_RUNNER_ALLOW_NO_AUTH=true unless the caller's
 * env overrides it (process.env spread last) — local/dev only; deployed
 * sidecars require CAD_RUNNER_SECRET (see cad-runner/app.py).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerDir = path.join(root, "cad-runner");
const venvPython = path.join(runnerDir, ".venv", "bin", "python");
const port = Number(process.env.CAD_RUNNER_PORT || 8000);

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
}

const children = [];
let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (process.env.CAD_DEV_SIDECAR === "false") {
  console.log("[sidecar] disabled (CAD_DEV_SIDECAR=false)");
} else if (!existsSync(venvPython)) {
  console.log(
    "[sidecar] cad-runner/.venv not found — Next only. To enable text-to-CAD locally: cd cad-runner && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  );
} else if (!(await portFree(port))) {
  console.log(`[sidecar] port ${port} already in use — reusing that sidecar`);
} else {
  const sidecar = spawn(
    venvPython,
    ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: runnerDir,
      // Spread order matters: the caller's env wins, so a shell that sets
      // CAD_RUNNER_SECRET (or ALLOW_NO_AUTH=false) is respected.
      env: { CAD_RUNNER_ALLOW_NO_AUTH: "true", ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const prefix = (chunk) =>
    String(chunk)
      .split("\n")
      .filter(Boolean)
      .map((l) => `[sidecar] ${l}`)
      .join("\n");
  sidecar.stdout.on("data", (c) => console.log(prefix(c)));
  sidecar.stderr.on("data", (c) => console.error(prefix(c)));
  sidecar.on("exit", (code) => {
    // A dead sidecar shouldn't kill the app — the studio degrades to its
    // "sessions unavailable" state and everything else works.
    if (!exiting) console.error(`[sidecar] exited (code ${code}) — text-to-CAD is down until you restart dev`);
  });
  children.push(sidecar);
  console.log(`[sidecar] started on http://127.0.0.1:${port} (dev no-auth mode)`);
}

const next = spawn(path.join(root, "node_modules", ".bin", "next"), ["dev"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
children.push(next);
next.on("exit", (code) => shutdown(code ?? 0));
