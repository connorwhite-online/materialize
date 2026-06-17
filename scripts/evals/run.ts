/**
 * Text-to-CAD eval runner. For each frozen case: generate build123d via the
 * model, execute it in the CAD runner sidecar, grade with the same oracle
 * the harness uses (validity + dimensional accuracy), and print a scorecard
 * by tier. This is the loop that makes "improve the harness" measurable.
 *
 * Standalone by design — talks to the model (Claude Agent SDK) and the
 * sidecar (HTTP) directly, so it imports only pure shared helpers and never
 * the server-only app modules.
 *
 * Usage:
 *   CAD_RUNNER_URL=http://localhost:8000 \
 *   CLAUDE_CODE_OAUTH_TOKEN=... \
 *   tsx scripts/evals/run.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  SYSTEM_PROMPT,
  extractCode,
  gradeRun,
  type RunGrade,
} from "../../lib/cad/prompt";
import type { CadRunResult } from "../../lib/cad/types";
import { EVAL_CASES, type EvalCase, type EvalTier } from "./cases";

const RUNNER_URL = process.env.CAD_RUNNER_URL;

// NOTE: intentionally mirrors completeText() in lib/cad/model-client.ts.
// Kept standalone so the eval script depends only on pure shared helpers
// (no "server-only" import chain) — keep the two in sync if either changes.
async function generate(prompt: string): Promise<string> {
  const result = query({
    prompt: `Create a 3D model: ${prompt}`,
    options: { systemPrompt: SYSTEM_PROMPT, allowedTools: [], maxTurns: 1 },
  });
  let text = "";
  for await (const message of result) {
    if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; text?: string };
          if (b.type === "text" && typeof b.text === "string") text += b.text;
        }
      }
    }
  }
  return extractCode(text);
}

async function runCode(code: string): Promise<CadRunResult> {
  if (!RUNNER_URL) throw new Error("Set CAD_RUNNER_URL to a running sidecar");
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, formats: ["stl"] }),
  });
  if (!res.ok) throw new Error(`runner ${res.status}: ${await res.text()}`);
  return (await res.json()) as CadRunResult;
}

interface CaseResult {
  c: EvalCase;
  grade: RunGrade;
}

async function main() {
  const results: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(`• ${c.id} … `);
    try {
      const code = await generate(c.prompt);
      const run = await runCode(code);
      const grade = gradeRun(run, c.expectedDims);
      results.push({ c, grade });
      console.log(grade.pass ? "PASS" : `FAIL (${grade.failures.join(", ")})`);
    } catch (err) {
      results.push({
        c,
        grade: { pass: false, failures: [String(err)], dimsOk: null },
      });
      console.log(`ERROR (${err})`);
    }
  }

  // Scorecard by tier.
  const tiers: EvalTier[] = ["primitive", "bracket", "container", "mechanical"];
  console.log("\n=== Scorecard ===");
  for (const tier of tiers) {
    const inTier = results.filter((r) => r.c.tier === tier);
    if (inTier.length === 0) continue;
    const pass = inTier.filter((r) => r.grade.pass).length;
    console.log(`${tier.padEnd(11)} ${pass}/${inTier.length}`);
  }
  const total = results.length;
  const passed = results.filter((r) => r.grade.pass).length;
  console.log(`${"TOTAL".padEnd(11)} ${passed}/${total}`);

  // Non-zero exit when nothing passed, so CI can gate on it later.
  if (passed === 0 && total > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
