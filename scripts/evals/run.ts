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
  SYSTEM_PROMPT_CADQUERY,
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
import {
  checkDimensionTargets,
  summarizeDimensionChecks,
  dimensionTargetsFromExpectedDims,
  type DimensionCheckResult,
  type DimensionTarget,
} from "../../lib/cad/dimension-check";
import { CAD_FEEDBACK_TAG_LABELS, type CadFeedbackTag } from "../../lib/cad/feedback";
import type { CadRunResult } from "../../lib/cad/types";
import { EVAL_CASES, type EvalCase, type EvalTier } from "./cases";
import { gradeTurn, type EvalTurn, type TurnGrade } from "./turns";

const RUNNER_URL = process.env.CAD_RUNNER_URL;
// A/B the B-rep front-end: build123d (default) vs cadquery. Point CAD_RUNNER_URL
// at the matching sidecar (cadquery runs in its own venv on another port).
const ENGINE = process.env.CAD_EVAL_ENGINE === "cadquery" ? "cadquery" : "build123d";
const SYSTEM = ENGINE === "cadquery" ? SYSTEM_PROMPT_CADQUERY : SYSTEM_PROMPT;
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
  // Exemplars are build123d source — only inject them for that engine.
  if (ENGINE === "build123d") {
    const exemplars = formatExemplars(selectExemplars(prompt));
    if (exemplars) out += `\n\n${exemplars}`;
  }
  return out;
}

/** One generation from a fully-built user prompt (fresh or revision framing). */
async function generateRaw(userPrompt: string): Promise<string> {
  const msg = await client.messages.create({
    model: GEN_MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  return extractCode(textOf(msg));
}

async function generate(prompt: string): Promise<string> {
  return generateRaw(buildUserPrompt(prompt));
}

/**
 * Build the revision user prompt for a multi-turn eval, mirroring the harness
 * (agentic buildTaskPrompt / app/api/cad/generate): the current source + the
 * instruction, plus any prior-version feedback (tags + note) threaded exactly
 * as the studio does. If this feedback threading is dropped, a case whose
 * corrective target lives ONLY in the feedback will fail — that is the MTR-183
 * regression guard.
 */
function buildRevisePrompt(turn: EvalTurn, priorCode: string): string {
  const lines: string[] = [
    "Revise the following model per this instruction. Keep it parametric and honor every unrelated dimension.",
    `Instruction: ${turn.instruction}`,
    "",
    "Current code:",
    "```python",
    priorCode,
    "```",
  ];
  const tagLabels = (turn.feedbackTags ?? [])
    .map((t) => CAD_FEEDBACK_TAG_LABELS[t as CadFeedbackTag] ?? t)
    .filter(Boolean);
  const note = turn.feedbackNote?.trim();
  if (tagLabels.length > 0 || note) {
    lines.push("", "The previous version received this feedback — fix it:");
    if (tagLabels.length > 0) lines.push(`- Problems: ${tagLabels.join(", ")}`);
    if (note) lines.push(`- Note: ${note}`);
  }
  return lines.join("\n");
}

/**
 * VLM design-quality score (0-100), or null if unavailable. Sends the FULL
 * multi-view packet (opposed isos + top/front + section for hollow parts,
 * MTR-199) in one call — identical to what the harness judge sees — so the
 * scorecard's aesthetic number reflects the coverage guarantee, not a single
 * 3/4 view that can hide a rear/bottom defect.
 */
async function judge(
  prompt: string,
  renders: string[]
): Promise<number | null> {
  if (!JUDGE_ON || renders.length === 0) return null;
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
            ...renders.map(
              (data) =>
                ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data,
                  },
                })
            ),
          ],
        },
      ],
    });
    return parseJudgement(textOf(msg))?.score ?? null;
  } catch {
    return null;
  }
}

/**
 * Negative checks (MTR-201): LLM-judged from the render packet — the "must NOT
 * be present" row of the benchmark rubric, for properties geometry can't
 * express (decorative geometry, wrong tooth direction, exploded parts). Returns
 * a per-check verdict; null on any failure so a judge hiccup never fails a case
 * silently. All available render views go in one call.
 */
interface NegativeCheckResult {
  check: string;
  /** True = the forbidden property IS present (a violation). */
  violated: boolean;
}

async function judgeNegativeChecks(
  prompt: string,
  checks: string[],
  renders: string[]
): Promise<NegativeCheckResult[] | null> {
  if (!JUDGE_ON || checks.length === 0 || renders.length === 0) return null;
  const system = `You are inspecting neutral clay renders of a 3D-printable part for FORBIDDEN properties. For each listed property, answer whether it IS present in the renders. Judge only what you can SEE; if a property cannot be determined from the views, answer false (absent). Output ONLY strict JSON: {"results":[{"i":0,"present":true|false}, ...]} with one entry per property index.`;
  try {
    const msg = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Requested object: ${prompt}\n\nForbidden properties (report each as present/absent):\n${checks
                .map((c, i) => `${i}. ${c}`)
                .join("\n")}`,
            },
            ...renders.map(
              (data) =>
                ({
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: "image/png" as const, data },
                })
            ),
          ],
        },
      ],
    });
    const match = textOf(msg).match(/\{[\s\S]*\}/);
    if (!match) return null;
    const raw = JSON.parse(match[0]) as { results?: { i: number; present: boolean }[] };
    if (!Array.isArray(raw.results)) return null;
    return checks.map((check, i) => ({
      check,
      violated: raw.results!.find((r) => r.i === i)?.present === true,
    }));
  } catch {
    return null;
  }
}

/** The dimension targets to check for a case: structured expectations win, else the legacy bbox. */
function effectiveTargets(c: EvalCase): DimensionTarget[] {
  if (c.expectations?.dims?.length) return c.expectations.dims;
  return dimensionTargetsFromExpectedDims(c.expectedDims);
}

/** Every render view the sidecar returned, for the multi-view judges. */
function allRenders(run: CadRunResult): string[] {
  const views = Object.values(run.renders ?? {}).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (views.length > 0) return views;
  return run.renderPng ? [run.renderPng] : [];
}

async function runCode(code: string): Promise<CadRunResult> {
  if (!RUNNER_URL) throw new Error("Set CAD_RUNNER_URL to a running sidecar");
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, formats: ["stl"], engine: ENGINE }),
  });
  if (!res.ok) throw new Error(`runner ${res.status}: ${await res.text()}`);
  return (await res.json()) as CadRunResult;
}

interface CaseResult {
  c: EvalCase;
  grade: RunGrade;
  /** VLM design-quality score (0-100), null when not scored. */
  aesthetic: number | null;
  /** MTR-197 dimension-contract results (only checks that ran are counted). */
  dimResults: DimensionCheckResult[];
  /** MTR-201 negative-check verdicts; null when not judged. */
  negResults: NegativeCheckResult[] | null;
  /** MTR-183 per-turn grades for a revision chain; empty for single-shot cases. */
  turnGrades: TurnGrade[];
}

/** Run a case's revision chain (MTR-183), grading each turn deterministically. */
async function runRevisionChain(
  c: EvalCase,
  turn0Code: string,
  turn0Run: CadRunResult
): Promise<TurnGrade[]> {
  const grades: TurnGrade[] = [];
  let priorCode = turn0Code;
  let priorRun = turn0Run;
  for (const turn of c.turns ?? []) {
    try {
      const nextCode = await generateRaw(buildRevisePrompt(turn, priorCode));
      const nextRun = await runCode(nextCode);
      grades.push(
        gradeTurn({ prevCode: priorCode, nextCode, prevRun: priorRun, nextRun, assert: turn.assert })
      );
      priorCode = nextCode;
      priorRun = nextRun;
    } catch (err) {
      grades.push({ pass: false, failures: [String(err)] });
      break; // a broken turn stops the chain — later turns build on this state
    }
  }
  return grades;
}

function avg(nums: number[]): number | null {
  return nums.length
    ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
    : null;
}

/** Per-case: ran dimension checks + negative-check violations, compactly. */
function dimTag(r: CaseResult): string {
  const s = summarizeDimensionChecks(r.dimResults);
  return s.label ? `  dims ${s.label}` : "";
}
function negTag(r: CaseResult): string {
  if (!r.negResults) return "";
  const violated = r.negResults.filter((n) => n.violated).length;
  return violated > 0 ? `  ⚠ ${violated} neg-violation(s)` : "  neg ✓";
}
/** Per-case: revision-chain turn results (MTR-183). */
function turnTag(r: CaseResult): string {
  if (r.turnGrades.length === 0) return "";
  const passed = r.turnGrades.filter((t) => t.pass).length;
  const chain = passed === r.turnGrades.length ? "✓" : "✗";
  return `  turns ${passed}/${r.turnGrades.length} ${chain}`;
}

async function main() {
  const results: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(`• ${c.id} … `);
    try {
      const code = await generate(c.prompt);
      const run = await runCode(code);
      const grade = gradeRun(run, c.expectedDims);
      // Dimension contract (MTR-197 machinery — same code path as the harness).
      const dimResults = checkDimensionTargets(run, effectiveTargets(c));
      const aesthetic = grade.pass ? await judge(c.prompt, allRenders(run)) : null;
      // Negative checks only make sense once a real solid exists to look at.
      const negResults = grade.pass
        ? await judgeNegativeChecks(c.prompt, c.expectations?.negativeChecks ?? [], allRenders(run))
        : null;
      // Multi-turn revision chain (MTR-183) — only meaningful once turn 0 is a
      // valid solid to revise; a broken base is a base failure, not a turn one.
      const turnGrades =
        c.turns?.length && grade.pass ? await runRevisionChain(c, code, run) : [];
      const cr: CaseResult = { c, grade, aesthetic, dimResults, negResults, turnGrades };
      results.push(cr);
      const tag = aesthetic == null ? "" : `  aesthetic ${aesthetic}/100`;
      console.log(
        (grade.pass ? "PASS" : `FAIL (${grade.failures.join(", ")})`) +
          tag +
          dimTag(cr) +
          negTag(cr) +
          turnTag(cr)
      );
    } catch (err) {
      results.push({
        c,
        grade: { pass: false, failures: [String(err)], dimsOk: null },
        aesthetic: null,
        dimResults: [],
        negResults: null,
        turnGrades: [],
      });
      console.log(`ERROR (${err})`);
    }
  }

  // Scorecard by tier: validity pass-rate + mean design-quality score +
  // dimension accuracy (passed/ran across the tier, honesty-railed) + negative
  // checks clean (cases with all forbidden properties absent).
  const tiers: EvalTier[] = [
    "primitive",
    "bracket",
    "container",
    "mechanical",
    "assembly",
    "implicit",
    "implicit-composite",
    "benchmark",
    "revision",
  ];
  const dimAccuracy = (rs: CaseResult[]): string => {
    let ran = 0;
    let passed = 0;
    for (const r of rs) {
      const s = summarizeDimensionChecks(r.dimResults);
      ran += s.ran;
      passed += s.passed;
    }
    return ran > 0 ? `${passed}/${ran}` : "—";
  };
  const negClean = (rs: CaseResult[]): string => {
    const judged = rs.filter((r) => r.negResults != null);
    if (judged.length === 0) return "—";
    const clean = judged.filter((r) => r.negResults!.every((n) => !n.violated)).length;
    return `${clean}/${judged.length}`;
  };
  console.log(
    `\n=== Scorecard [engine: ${ENGINE}, model: ${GEN_MODEL}] (validity | aesthetic | dim-acc | neg-clean) ===`
  );
  for (const tier of tiers) {
    const inTier = results.filter((r) => r.c.tier === tier);
    if (inTier.length === 0) continue;
    const pass = inTier.filter((r) => r.grade.pass).length;
    const a = avg(
      inTier.map((r) => r.aesthetic).filter((x): x is number => x != null)
    );
    console.log(
      `${tier.padEnd(18)} ${pass}/${inTier.length}    ${(a == null ? "—" : `${a}/100`).padEnd(8)} ${dimAccuracy(inTier).padEnd(8)} ${negClean(inTier)}`
    );
  }
  const passed = results.filter((r) => r.grade.pass).length;
  const meanA = avg(
    results.map((r) => r.aesthetic).filter((x): x is number => x != null)
  );
  console.log(
    `${"TOTAL".padEnd(18)} ${passed}/${results.length}    ${(meanA == null ? "—" : `${meanA}/100`).padEnd(8)} ${dimAccuracy(results).padEnd(8)} ${negClean(results)}`
  );

  // Revision scorecard (MTR-183): score the CONVERSATION, not just the first
  // shot — per-turn (did each requested delta land without regression) and
  // per-chain (did the whole revision sequence hold).
  const chains = results.filter((r) => r.turnGrades.length > 0);
  if (chains.length > 0) {
    const allTurns = chains.flatMap((r) => r.turnGrades);
    const turnsPassed = allTurns.filter((t) => t.pass).length;
    const chainsPassed = chains.filter((r) => r.turnGrades.every((t) => t.pass)).length;
    console.log(`\n=== Revision chains (MTR-183) ===`);
    for (const r of chains) {
      const p = r.turnGrades.filter((t) => t.pass).length;
      const firstFail = r.turnGrades.find((t) => !t.pass);
      console.log(
        `${r.c.id.padEnd(24)} turns ${p}/${r.turnGrades.length}` +
          (firstFail ? `  — ${firstFail.failures.join("; ")}` : "  ✓")
      );
    }
    console.log(
      `${"per-turn".padEnd(24)} ${turnsPassed}/${allTurns.length} landed   ` +
        `${"chains".padEnd(6)} ${chainsPassed}/${chains.length}`
    );
  }

  // Non-zero exit when nothing passed, so CI can gate on it later.
  if (passed === 0 && results.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
