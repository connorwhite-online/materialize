/**
 * Verify the build123d exemplars compile and produce valid solids in the CAD
 * sidecar, so they can be marked `verified: true` in lib/cad/knowledge/exemplars.ts.
 *
 * Exemplars are only injected into real prompts when verified — this is the
 * gate. Run against a live sidecar:
 *
 *   CAD_RUNNER_URL=http://localhost:8000 npx tsx scripts/verify-exemplars.ts
 *
 * Talks to the sidecar over HTTP directly (no server-only import chain, like
 * scripts/evals/run.ts). Exits non-zero if any exemplar fails so it can gate CI.
 */
import { CAD_EXEMPLARS } from "../lib/cad/knowledge/exemplars";

const RUNNER_URL = process.env.CAD_RUNNER_URL;

interface RunResult {
  ok: boolean;
  validation: {
    compiled: boolean;
    isSolid: boolean;
    isWatertight: boolean;
    isManifold: boolean;
  };
  error?: string;
}

async function run(code: string): Promise<RunResult> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.CAD_RUNNER_SECRET
        ? { Authorization: `Bearer ${process.env.CAD_RUNNER_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ code, formats: ["stl"] }),
  });
  if (!res.ok) throw new Error(`runner ${res.status}: ${await res.text()}`);
  return (await res.json()) as RunResult;
}

async function main() {
  if (!RUNNER_URL) {
    console.error("Set CAD_RUNNER_URL to a running cad-runner sidecar.");
    process.exit(2);
  }

  let failures = 0;
  for (const ex of CAD_EXEMPLARS) {
    try {
      const r = await run(ex.code);
      const v = r.validation;
      const pass = r.ok && v.compiled && v.isSolid && v.isWatertight;
      console.log(
        `${pass ? "PASS" : "FAIL"}  ${ex.id}  ` +
          `(compiled=${v.compiled} solid=${v.isSolid} watertight=${v.isWatertight} manifold=${v.isManifold})` +
          (r.error ? `  ${r.error}` : "")
      );
      if (!pass) failures++;
    } catch (err) {
      console.log(`ERROR ${ex.id}  ${(err as Error).message}`);
      failures++;
    }
  }

  console.log(
    `\n${CAD_EXEMPLARS.length - failures}/${CAD_EXEMPLARS.length} exemplars valid.` +
      (failures
        ? " Fix the failing code before setting verified: true."
        : " All pass — safe to set verified: true.")
  );
  process.exit(failures ? 1 : 0);
}

main();
