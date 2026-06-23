/**
 * Text-to-CAD eval runner. For each frozen case: generate build123d via the
 * model, execute it in the CAD runner sidecar, grade with the same oracle the
 * harness uses (validity + dimensional accuracy), AND — when a render comes
 * back — score design quality with the same VLM rubric the harness judges on.
 * Validity tells you it compiles; the aesthetic score is the gradient that
 * makes "is it actually getting better?" measurable.
 *
 * Standalone by design — talks to the model + sidecar directly and imports only
 * PURE shared helpers (no `server-only` chain). The generate prompt mirrors the
 * harness (knowledge block + matching exemplar) so the scorecard reflects what
 * we actually ship, not a stripped-down prompt.
 *
 * Usage:
 *   CAD_RUNNER_URL=http://localhost:8000 \
 *   ANTHROPIC_API_KEY=... (or CLAUDE_CODE_OAUTH_TOKEN=...) \
 *   tsx scripts/evals/run.ts
 *
 * Set CAD_AESTHETIC_JUDGE=false to skip the quality scoring (validity only).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  extractCode,
  gradeRun,
  type RunGrade,
} from "../../lib/cad/prompt";
import { buildKnowledgeBlock } from "../../lib/cad/knowledge";
import {
  selectExemplars,
  formatExemplars,
} from "../../lib/cad/knowledge/exemplars";
import { CRITIQUE_RUBRIC, parseJudgement } from "../../lib/cad/critique-core";
import type { CadRunResult } from "../../lib/cad/types";
import { EVAL_CASES, type EvalCase, type EvalTier } from "./cases";

const RUNNER_URL = process.env.CAD_RUNNER_URL;
const GEN_MODEL =
  process.env.CAD_MODEL_IMPLEMENT ||
  process.env.CAD_MODEL_DEFAULT ||
  "claude-sonnet-4-6";
const JUDGE_MODEL = process.env.CAD_AESTHETIC_JUDGE_MODEL || "claude-opus-4-8";
const JUDGE_ON = process.env.CAD_AESTHETIC_JUDGE !== "false";

// Mirror getClient() in lib/cad/model-client.ts: prefer the API key, fall back
// to the Claude Code OAuth token as a bearer.
function makeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey
    ? new Anthropic({ apiKey })
    : new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN });
}
const client = makeClient();

/** Concatenate the assistant text blocks from a Messages response. */
function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Build the same fresh-build user prompt the harness sends (buildUserPrompt):
 * the task + knowledge block + the best-matching verified exemplar.
 */
function buildUserPrompt(prompt: string): string {
  const knowledge = buildKnowledgeBlock({ prompt });
  let out = `Create a 3D model: ${prompt}\n\nDesign guidance to follow:\n\n${knowledge}`;
  const exemplars = formatExemplars(selectExemplars(prompt));
  if (exemplars) out += `\n\n${exemplars}`;
  return out;
}

async function generate(prompt: string): Promise<string> {
  const msg = await client.messages.create({
    model: GEN_MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(prompt) }],
  });
  return extractCode(textOf(msg));
}

/** VLM design-quality score (0-100) for a render, or null if unavailable. */
async function judge(
  prompt: string,
  renderPng?: string
): Promise<number | null> {
  if (!JUDGE_ON || !renderPng) return null;
  try {
    const msg = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      system: CRITIQUE_RUBRIC,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Requested object: ${prompt}` },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: renderPng,
              },
            },
          ],
        },
      ],
    });
    return parseJudgement(textOf(msg))?.score ?? null;
  } catch {
    return null;
  }
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
  /** VLM design-quality score (0-100), null when not scored. */
  aesthetic: number | null;
}

function avg(nums: number[]): number | null {
  return nums.length
    ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
    : null;
}

async function main() {
  const results: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(`• ${c.id} … `);
    try {
      const code = await generate(c.prompt);
      const run = await runCode(code);
      const grade = gradeRun(run, c.expectedDims);
      const aesthetic = grade.pass ? await judge(c.prompt, run.renderPng) : null;
      results.push({ c, grade, aesthetic });
      const tag = aesthetic == null ? "" : `  aesthetic ${aesthetic}/100`;
      console.log(
        (grade.pass ? "PASS" : `FAIL (${grade.failures.join(", ")})`) + tag
      );
    } catch (err) {
      results.push({
        c,
        grade: { pass: false, failures: [String(err)], dimsOk: null },
        aesthetic: null,
      });
      console.log(`ERROR (${err})`);
    }
  }

  // Scorecard by tier: validity pass-rate + mean design-quality score.
  const tiers: EvalTier[] = [
    "primitive",
    "bracket",
    "container",
    "mechanical",
    "assembly",
    "implicit",
  ];
  console.log("\n=== Scorecard (validity | mean aesthetic) ===");
  for (const tier of tiers) {
    const inTier = results.filter((r) => r.c.tier === tier);
    if (inTier.length === 0) continue;
    const pass = inTier.filter((r) => r.grade.pass).length;
    const a = avg(
      inTier.map((r) => r.aesthetic).filter((x): x is number => x != null)
    );
    console.log(
      `${tier.padEnd(11)} ${pass}/${inTier.length}    ${a == null ? "—" : `${a}/100`}`
    );
  }
  const passed = results.filter((r) => r.grade.pass).length;
  const meanA = avg(
    results.map((r) => r.aesthetic).filter((x): x is number => x != null)
  );
  console.log(
    `${"TOTAL".padEnd(11)} ${passed}/${results.length}    ${meanA == null ? "—" : `${meanA}/100`}`
  );

  // Non-zero exit when nothing passed, so CI can gate on it later.
  if (passed === 0 && results.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
