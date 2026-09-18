/**
 * Engine bake-off runner: build123d (B-rep) vs sdf_kit (implicit) on the same
 * frozen prompt set, reporting the numbers that decide which engine to keep.
 *
 * Standalone by design, like scripts/evals/run.ts: it talks to the model and
 * the sidecar directly over HTTP and imports only PURE modules. It must NOT
 * import the harness — that pulls `server-only` through @/lib/db and the
 * script dies at import (the trap scripts/cad-failure-miner.ts is still stuck
 * in). The engine registry, the prompts, the knowledge blocks, the exemplars
 * and the failure taxonomy are all pure, which is what makes this possible.
 *
 * Usage:
 *   CAD_RUNNER_URL=http://localhost:8000 CAD_RUNNER_SECRET=... \
 *   ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/bench/run.ts
 *
 *   --engines brep,sdf     which engines to run (default both)
 *   --cases id1,id2        only these case ids
 *   --seeded               only cases seeded from real production failures
 *   --attempts 3           repair attempts per case (default 3)
 *   --out results.json     write the raw per-run records
 *   --dry-run              assemble prompts only, no model or sidecar calls
 *   --concurrency 2        cases in flight (default 1 — sidecar is the bottleneck)
 */
import fs from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { allEngines, engineFor, type CadEngineId } from "../../lib/cad/engines";
import { extractCode } from "../../lib/cad/prompt";
import { buildKnowledgeBlock } from "../../lib/cad/knowledge";
import {
  exemplarPoolFor,
  formatExemplars,
  selectExemplars,
} from "../../lib/cad/knowledge/exemplars";
import {
  classifyKernelError,
  enrichRepairHint,
  type KernelFailureClass,
} from "../../lib/cad/repair-taxonomy";
import { BENCH_CASES, productionSeeded, type BenchCase } from "./cases";

// Lift credentials out of .env.local when run directly (Next only auto-loads
// them for framework contexts). Same pattern as the other scripts.
if (!process.env.CAD_RUNNER_URL || !process.env.ANTHROPIC_API_KEY) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const RUNNER_URL = process.env.CAD_RUNNER_URL;
const MODEL =
  process.env.CAD_MODEL_IMPLEMENT || process.env.CAD_MODEL_DEFAULT || "claude-sonnet-5";
const MAX_ATTEMPTS = Number(flag("attempts") ?? 3);
const CONCURRENCY = Math.max(1, Number(flag("concurrency") ?? 1));

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN });

interface SidecarRun {
  ok: boolean;
  error?: string;
  validation: {
    compiled: boolean;
    isSolid: boolean;
    isWatertight: boolean;
    isManifold: boolean;
    bodyCount?: number;
  };
  geometry?: { triangleCount?: number; dimensions?: { x: number; y: number; z: number } };
  checks?: { dfm?: Record<string, unknown> };
}

/** One engine's whole attempt chain on one case. */
export interface BenchRecord {
  caseId: string;
  category: string;
  expectedEdge: string;
  engine: CadEngineId;
  ok: boolean;
  attempts: number;
  /** ms spent inside model calls. */
  modelMs: number;
  /** ms spent inside sidecar geometry execution. */
  geometryMs: number;
  /** Wall-clock to the first attempt that produced a valid mesh; null if none. */
  timeToFirstValidMeshMs: number | null;
  triangles: number | null;
  watertight: boolean | null;
  failureClass: KernelFailureClass | null;
  error?: string;
  dfm?: Record<string, unknown>;
}

async function callModel(
  system: string,
  messages: Anthropic.MessageParam[]
): Promise<{ text: string; ms: number }> {
  const t = Date.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages,
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, ms: Date.now() - t };
}

async function execSidecar(
  code: string,
  engine: CadEngineId
): Promise<{ run: SidecarRun; ms: number }> {
  const profile = engineFor(engine);
  const t = Date.now();
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CAD_RUNNER_SECRET ?? ""}`,
    },
    body: JSON.stringify({
      code,
      formats: profile.outputFormats,
      engine: profile.sidecarEngine,
      allowRemesh: false,
      // Printability probes ride along so the scorecard can report DFM pass
      // rate, not just "it is a closed surface".
      checks: { dfm: { minWall: 1.5, overhangDeg: 45 } },
    }),
  });
  if (!res.ok) throw new Error(`sidecar ${res.status}: ${await res.text()}`);
  return { run: (await res.json()) as SidecarRun, ms: Date.now() - t };
}

function isValid(run: SidecarRun): boolean {
  const v = run.validation;
  return Boolean(run.ok && v.compiled && v.isSolid && v.isWatertight && v.isManifold);
}

function failureNote(run: SidecarRun): string {
  const v = run.validation;
  const notes: string[] = [];
  if (!v.compiled) notes.push("did not compile/run");
  if (!v.isSolid) notes.push("not a solid");
  if (!v.isWatertight) notes.push("not watertight");
  if (!v.isManifold) notes.push("non-manifold");
  if (run.error) notes.push(`error: ${run.error}`);
  return notes.join("; ");
}

async function runOne(bench: BenchCase, engine: CadEngineId): Promise<BenchRecord> {
  const profile = engineFor(engine);
  const system = profile.systemPrompt(bench.prompt);
  const knowledge = buildKnowledgeBlock({ prompt: bench.prompt });
  const exemplars = formatExemplars(
    selectExemplars(bench.prompt, {
      pool: exemplarPoolFor(engine, { prompt: bench.prompt }),
    })
  );

  const started = Date.now();
  let modelMs = 0;
  let geometryMs = 0;
  let timeToFirstValidMeshMs: number | null = null;
  let last: SidecarRun | null = null;
  let lastError: string | undefined;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [bench.prompt, knowledge, exemplars].filter(Boolean).join("\n\n"),
    },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let code: string;
    try {
      const out = await callModel(system, messages);
      modelMs += out.ms;
      code = extractCode(out.text);
      messages.push({ role: "assistant", content: out.text });
    } catch (err) {
      lastError = `model call failed: ${(err as Error).message}`;
      break;
    }

    try {
      const out = await execSidecar(code, engine);
      geometryMs += out.ms;
      last = out.run;
    } catch (err) {
      lastError = `sidecar call failed: ${(err as Error).message}`;
      break;
    }

    if (isValid(last)) {
      timeToFirstValidMeshMs = Date.now() - started;
      return {
        caseId: bench.id,
        category: bench.category,
        expectedEdge: bench.expectedEdge,
        engine,
        ok: true,
        attempts: attempt,
        modelMs,
        geometryMs,
        timeToFirstValidMeshMs,
        triangles: last.geometry?.triangleCount ?? null,
        watertight: last.validation.isWatertight,
        failureClass: null,
        dfm: last.checks?.dfm,
      };
    }

    const note = failureNote(last);
    lastError = note;
    if (attempt < MAX_ATTEMPTS) {
      messages.push({
        role: "user",
        content:
          `That attempt failed: ${note}\n\n${enrichRepairHint(note)}\n\n` +
          `Fix it and output the corrected full script.`,
      });
    }
  }

  return {
    caseId: bench.id,
    category: bench.category,
    expectedEdge: bench.expectedEdge,
    engine,
    ok: false,
    attempts: MAX_ATTEMPTS,
    modelMs,
    geometryMs,
    timeToFirstValidMeshMs: null,
    triangles: last?.geometry?.triangleCount ?? null,
    watertight: last?.validation.isWatertight ?? null,
    failureClass: classifyKernelError(lastError ?? "")?.class ?? null,
    error: lastError,
    dfm: last?.checks?.dfm,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "  —  " : `${((100 * n) / d).toFixed(0).padStart(3)}%`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function report(records: BenchRecord[], engines: CadEngineId[]): void {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`Engine bake-off · ${MODEL} · ${MAX_ATTEMPTS} attempts/case`);
  console.log("═".repeat(72));

  console.log(`\n${"case".padEnd(26)}${engines.map((e) => e.padEnd(22)).join("")}`);
  for (const bench of BENCH_CASES) {
    const row = records.filter((r) => r.caseId === bench.id);
    if (row.length === 0) continue;
    const cells = engines.map((e) => {
      const r = row.find((x) => x.engine === e);
      if (!r) return "".padEnd(22);
      const mark = r.ok ? "PASS" : "FAIL";
      const secs = r.timeToFirstValidMeshMs
        ? `${(r.timeToFirstValidMeshMs / 1000).toFixed(0)}s`
        : "—";
      return `${mark} ${String(r.attempts)}× ${secs}`.padEnd(22);
    });
    console.log(`${bench.id.padEnd(26)}${cells.join("")}`);
  }

  console.log(`\n${"─".repeat(72)}`);
  for (const e of engines) {
    const rs = records.filter((r) => r.engine === e);
    const ok = rs.filter((r) => r.ok);
    const ttfm = median(
      ok.map((r) => r.timeToFirstValidMeshMs!).filter((n) => Number.isFinite(n))
    );
    const tris = median(ok.map((r) => r.triangles ?? 0).filter(Boolean));
    const dfmOk = ok.filter((r) => r.dfm?.ok === true).length;
    console.log(
      `${engineFor(e).label}\n` +
        `  success            ${pct(ok.length, rs.length)}  (${ok.length}/${rs.length})\n` +
        `  median time to 1st valid mesh  ${ttfm === null ? "—" : `${(ttfm / 1000).toFixed(0)}s`}\n` +
        `  median attempts    ${median(rs.map((r) => r.attempts)) ?? "—"}\n` +
        `  model vs geometry  ${(rs.reduce((a, r) => a + r.modelMs, 0) / 1000).toFixed(0)}s / ` +
        `${(rs.reduce((a, r) => a + r.geometryMs, 0) / 1000).toFixed(0)}s\n` +
        `  median triangles   ${tris ?? "—"}\n` +
        `  DFM clean          ${pct(dfmOk, ok.length)}  (of passing runs)`
    );
  }

  // Split by the PRIOR, so the scorecard cannot be read as whatever the
  // reader already believed. A set is only fair if the cases it expects the
  // other engine to win are reported separately.
  console.log(`\n${"─".repeat(72)}\nBy expected edge (declared before the run)`);
  for (const edge of ["brep", "sdf", "either"]) {
    const subset = records.filter((r) => r.expectedEdge === edge);
    if (subset.length === 0) continue;
    const line = engines
      .map((e) => {
        const rs = subset.filter((r) => r.engine === e);
        return `${e} ${pct(rs.filter((r) => r.ok).length, rs.length)}`;
      })
      .join("   ");
    console.log(`  expected ${edge.padEnd(7)} ${line}`);
  }

  console.log(`\n${"─".repeat(72)}\nFailure classes`);
  for (const e of engines) {
    const fails = records.filter((r) => r.engine === e && !r.ok);
    if (fails.length === 0) {
      console.log(`  ${e}: none`);
      continue;
    }
    const hist = new Map<string, number>();
    for (const f of fails) {
      const k = f.failureClass ?? "unclassified";
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    const parts = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ×${n}`);
    console.log(`  ${e}: ${parts.join(", ")}`);
  }

  const seeded = records.filter((r) =>
    productionSeeded().some((c) => c.id === r.caseId)
  );
  if (seeded.length > 0) {
    console.log(`\n${"─".repeat(72)}\nProduction-seeded cases (these all failed for real)`);
    for (const e of engines) {
      const rs = seeded.filter((r) => r.engine === e);
      console.log(`  ${e}: ${pct(rs.filter((r) => r.ok).length, rs.length)} now pass`);
    }
  }
  console.log();
}

/**
 * Assemble every prompt without calling anything. A full bake-off is 32
 * generations of real model spend, so "does this even build its prompts"
 * should not be answered by watching the first one fail.
 */
function dryRun(cases: BenchCase[], engines: CadEngineId[]): void {
  console.log(`\nDry run — ${cases.length} cases × ${engines.length} engines\n`);
  for (const bench of cases) {
    const cells = engines.map((e) => {
      const profile = engineFor(e);
      const system = profile.systemPrompt(bench.prompt);
      const pool = exemplarPoolFor(e, { prompt: bench.prompt });
      const chosen = selectExemplars(bench.prompt, { pool });
      return `${e}: ${system.length}ch, ${chosen.length} exemplar(s) [${
        chosen.map((x) => x.id).join(",") || "none"
      }]`;
    });
    console.log(`  ${bench.id.padEnd(26)} ${cells.join("  |  ")}`);
  }
  console.log(
    `\nExemplar pools (prompt-independent): ${engines
      .map((e) => `${e}=${exemplarPoolFor(e).length}`)
      .join(", ")}\n`
  );
}

async function main() {
  const dry = has("dry-run");
  if (!RUNNER_URL && !dry) {
    throw new Error(
      "Missing CAD_RUNNER_URL. The bake-off needs a live sidecar built from " +
        "this branch (it must carry manifold3d and dfm.py)."
    );
  }
  const engines = (flag("engines")?.split(",") as CadEngineId[] | undefined) ??
    allEngines().map((e) => e.id);
  const only = flag("cases")?.split(",");
  const cases = has("seeded")
    ? productionSeeded()
    : only
      ? BENCH_CASES.filter((c) => only.includes(c.id))
      : BENCH_CASES;

  if (dry) {
    dryRun(cases, engines);
    return;
  }

  console.log(
    `Running ${cases.length} cases × ${engines.length} engines ` +
      `(${cases.length * engines.length} generations)…`
  );

  const jobs: Array<{ bench: BenchCase; engine: CadEngineId }> = [];
  for (const bench of cases) for (const engine of engines) jobs.push({ bench, engine });

  const records: BenchRecord[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        const { bench, engine } = jobs[i];
        try {
          const rec = await runOne(bench, engine);
          records.push(rec);
          console.log(
            `  ${rec.ok ? "PASS" : "FAIL"}  ${engine.padEnd(5)} ${bench.id}` +
              `${rec.ok ? "" : `  (${rec.failureClass ?? "unclassified"})`}`
          );
        } catch (err) {
          console.log(`  ERR   ${engine.padEnd(5)} ${bench.id}: ${(err as Error).message}`);
        }
      }
    })
  );

  report(records, engines);

  const out = flag("out");
  if (out) {
    fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(records, null, 2));
    console.log(`Wrote ${records.length} records → ${out}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
