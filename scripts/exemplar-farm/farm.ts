/**
 * Exemplar farm (docs/text-to-cad/07 §D, generalized): run the
 * generate → judge → refine loop OFFLINE and proactively over a part-class
 * prompt bank, instead of waiting for organic 👍s (~3/month) to grow the
 * catalog. For each class:
 *
 *   1. best-of-N candidates (same prompt the harness ships: knowledge block
 *      + retrieved exemplar) → sidecar run → structural grade + VLM judge
 *   2. winner gets K refinement turns targeting its WEAKEST judge dimension;
 *      a refinement is kept only when the score actually improves
 *   3. survivors ≥ FARM_MIN_SCORE land in the candidates directory as
 *      {json, renders} for HUMAN review; promote.ts turns approved ones
 *      into catalog entries (verified stays a human signature)
 *
 * Classes that produce NO structurally-valid candidate are the other crop:
 * uncovered failure classes, reported at the end — threads-style gaps found
 * offline before a user finds them.
 *
 * Standalone like scripts/evals/run.ts: talks to the model + sidecar
 * directly, imports only pure shared helpers (no server-only chain).
 *
 *   ANTHROPIC_API_KEY=... CAD_RUNNER_URL=http://localhost:8000 \
 *   npx tsx scripts/exemplar-farm/farm.ts
 *
 * Knobs: FARM_CLASSES=phone_stand,pen_cup (filter) · FARM_CANDIDATES=3 ·
 * FARM_REFINE_ROUNDS=2 · FARM_MIN_SCORE=78 · FARM_OUT=dir
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { buildKnowledgeBlock } from "../../lib/cad/knowledge";
import {
  selectExemplars,
  formatExemplars,
} from "../../lib/cad/knowledge/exemplars";
import {
  buildSystemPrompt,
  selectSystemPromptSections,
  extractCode,
  gradeRun,
} from "../../lib/cad/prompt";
import {
  CRITIQUE_RUBRIC,
  parseJudgement,
  AESTHETIC_DIMENSIONS,
} from "../../lib/cad/critique-core";
import type { CadRunResult } from "../../lib/cad/types";
import { FARM_CLASSES, type FarmClass } from "./prompt-bank";
import type { FarmCandidate } from "./catalog-io";

const RUNNER_URL = process.env.CAD_RUNNER_URL || "http://localhost:8000";
const GEN_MODEL =
  process.env.CAD_MODEL_IMPLEMENT ||
  process.env.CAD_MODEL_DEFAULT ||
  "claude-sonnet-4-6";
const JUDGE_MODEL =
  process.env.CAD_MODEL_CRITIQUE ||
  process.env.CAD_AESTHETIC_JUDGE_MODEL ||
  "claude-sonnet-4-6";

const N_CANDIDATES = clampInt(process.env.FARM_CANDIDATES, 3, 1, 6);
const REFINE_ROUNDS = clampInt(process.env.FARM_REFINE_ROUNDS, 2, 0, 5);
const MIN_SCORE = clampInt(process.env.FARM_MIN_SCORE, 78, 0, 100);
const OUT_DIR =
  process.env.FARM_OUT || join("scripts", "exemplar-farm", "candidates");

function clampInt(
  raw: string | undefined,
  dflt: number,
  lo: number,
  hi: number
): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : dflt;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}
const client = new Anthropic({ apiKey });

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Mirror of the harness fresh-build user prompt (knowledge + exemplar). */
function buildUserPrompt(prompt: string): string {
  const knowledge = buildKnowledgeBlock({ prompt });
  let out = `Create a 3D model: ${prompt}\n\nDesign guidance to follow:\n\n${knowledge}`;
  const exemplars = formatExemplars(selectExemplars(prompt));
  if (exemplars) out += `\n\n${exemplars}`;
  return out;
}

async function generate(userPrompt: string, system: string): Promise<string> {
  const msg = await client.messages.create({
    model: GEN_MODEL,
    max_tokens: 8192,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });
  return extractCode(textOf(msg));
}

async function runSidecar(code: string): Promise<CadRunResult> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, formats: ["stl"] }),
  });
  if (!res.ok) throw new Error(`runner ${res.status}: ${await res.text()}`);
  return (await res.json()) as CadRunResult;
}

interface Judged {
  score: number;
  perDimension: Record<string, { score: number }>;
  feedback: string;
}

/** Multi-view VLM judge — same rubric/parser as the harness. */
async function judge(prompt: string, run: CadRunResult): Promise<Judged | null> {
  const views = Object.values(run.renders ?? {}).filter(
    (v): v is string => typeof v === "string"
  );
  const renders = views.length > 0 ? views : run.renderPng ? [run.renderPng] : [];
  if (renders.length === 0) return null;
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
            ...renders.map((data) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data,
              },
            })),
          ],
        },
      ],
    });
    const parsed = parseJudgement(textOf(msg));
    return parsed
      ? {
          score: parsed.score,
          perDimension: parsed.perDimension,
          feedback: parsed.feedback,
        }
      : null;
  } catch (err) {
    console.warn(`  judge failed: ${(err as Error).message}`);
    return null;
  }
}

function weakestDimension(j: Judged): string {
  let worst: string = AESTHETIC_DIMENSIONS[0];
  let min = Infinity;
  for (const d of AESTHETIC_DIMENSIONS) {
    const s = j.perDimension[d]?.score ?? Infinity;
    if (s < min) {
      min = s;
      worst = d;
    }
  }
  return worst;
}

function refinePrompt(
  cls: FarmClass,
  code: string,
  j: Judged
): string {
  const weakest = weakestDimension(j);
  return [
    `Refine this build123d model of: ${cls.prompt}`,
    "",
    `A design judge scored it ${j.score}/100. Weakest dimension: ${weakest}.`,
    `Judge feedback: ${j.feedback || "(none)"}`,
    "",
    "Improve the design with a focused revision: address the weakest dimension",
    "and the feedback WITHOUT regressing anything else. Keep it parametric,",
    "keep every functional dimension, keep it a single watertight solid (or",
    "the same parts dict). House style: soften what the hand touches — visible",
    "edges get generous fillets/chamfers (>= 2 mm where function allows), not",
    "razor-sharp intersections; prefer one cohesive flowing form over faceted",
    "sharpness. Output ONLY the full revised Python code block.",
    "",
    "Current code:",
    "```python",
    code,
    "```",
  ].join("\n");
}

interface ClassOutcome {
  cls: FarmClass;
  outcome: "candidate" | "below-threshold" | "no-valid-build";
  score?: number;
  detail?: string;
}

async function farmClass(cls: FarmClass): Promise<ClassOutcome> {
  const system = buildSystemPrompt(selectSystemPromptSections(cls.prompt));
  const userPrompt = buildUserPrompt(cls.prompt);

  // 1. Best-of-N: generate all candidates (model calls parallel; sidecar
  // runs sequential — it serializes anyway).
  const codes = (
    await Promise.all(
      Array.from({ length: N_CANDIDATES }, () =>
        generate(userPrompt, system).catch(() => null)
      )
    )
  ).filter((c): c is string => !!c && c.trim().length > 0);

  let best: { code: string; run: CadRunResult; judged: Judged } | null = null;
  const failures: string[] = [];
  for (const code of codes) {
    let run: CadRunResult;
    try {
      run = await runSidecar(code);
    } catch (err) {
      failures.push(String((err as Error).message).slice(0, 120));
      continue;
    }
    const grade = gradeRun(run);
    if (!grade.pass) {
      failures.push(grade.failures.join("; ").slice(0, 160));
      continue;
    }
    const judged = await judge(cls.prompt, run);
    if (!judged) continue;
    if (!best || judged.score > best.judged.score) best = { code, run, judged };
  }

  if (!best) {
    return {
      cls,
      outcome: "no-valid-build",
      detail: failures.slice(0, 3).join(" | ") || "no code produced",
    };
  }
  console.log(`  best-of-${codes.length}: ${best.judged.score}/100`);

  // 2. Refinement rounds: keep a revision only when the judge score improves.
  for (let r = 0; r < REFINE_ROUNDS; r++) {
    try {
      const revised = await generate(
        refinePrompt(cls, best.code, best.judged),
        system
      );
      if (!revised.trim()) continue;
      const run = await runSidecar(revised);
      if (!gradeRun(run).pass) {
        console.log(`  refine ${r + 1}: structurally invalid — discarded`);
        continue;
      }
      const judged = await judge(cls.prompt, run);
      if (!judged) continue;
      if (judged.score > best.judged.score) {
        console.log(`  refine ${r + 1}: ${best.judged.score} → ${judged.score}`);
        best = { code: revised, run, judged };
      } else {
        console.log(
          `  refine ${r + 1}: ${judged.score} (no improvement — kept ${best.judged.score})`
        );
      }
    } catch (err) {
      console.log(`  refine ${r + 1} errored: ${(err as Error).message}`);
    }
  }

  if (best.judged.score < MIN_SCORE) {
    return { cls, outcome: "below-threshold", score: best.judged.score };
  }

  // 3. Emit the candidate for human review.
  const candidate: FarmCandidate = {
    id: `farm_${cls.id}`,
    title: cls.title,
    keywords: cls.keywords,
    prompt: cls.prompt,
    // Lesson drafted by the judge feedback + class intent; the human can
    // reword at promote time (--lesson).
    lesson: `${cls.title} — farmed pattern for "${cls.keywords[0]}"-class prompts. Judge ${best.judged.score}/100.`,
    code: best.code,
    score: best.judged.score,
    perDimension: Object.fromEntries(
      Object.entries(best.judged.perDimension).map(([k, v]) => [k, v.score])
    ),
    farmedAt: new Date().toISOString(),
  };
  const dir = join(OUT_DIR, candidate.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "candidate.json"),
    JSON.stringify(candidate, null, 2)
  );
  const renders = best.run.renders ?? {};
  const views = Object.keys(renders).length
    ? renders
    : best.run.renderPng
      ? { threeQuarter: best.run.renderPng }
      : {};
  for (const [view, png] of Object.entries(views)) {
    if (typeof png === "string") {
      writeFileSync(join(dir, `${view}.png`), Buffer.from(png, "base64"));
    }
  }
  return { cls, outcome: "candidate", score: best.judged.score };
}

async function main() {
  const filter = (process.env.FARM_CLASSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const classes = filter.length
    ? FARM_CLASSES.filter((c) => filter.includes(c.id))
    : FARM_CLASSES;
  if (classes.length === 0) {
    console.error("No classes matched FARM_CLASSES filter.");
    process.exit(1);
  }
  console.log(
    `Farming ${classes.length} classes · N=${N_CANDIDATES} · refine=${REFINE_ROUNDS} · min=${MIN_SCORE}\n` +
      `gen=${GEN_MODEL} judge=${JUDGE_MODEL} sidecar=${RUNNER_URL}\n`
  );

  const outcomes: ClassOutcome[] = [];
  for (const cls of classes) {
    console.log(`▸ ${cls.id}`);
    try {
      outcomes.push(await farmClass(cls));
    } catch (err) {
      outcomes.push({
        cls,
        outcome: "no-valid-build",
        detail: (err as Error).message,
      });
    }
  }

  const candidates = outcomes.filter((o) => o.outcome === "candidate");
  const weak = outcomes.filter((o) => o.outcome === "below-threshold");
  const failed = outcomes.filter((o) => o.outcome === "no-valid-build");
  console.log(
    `\n== Farm report ==\n` +
      `candidates: ${candidates.length}  below-threshold: ${weak.length}  no-valid-build: ${failed.length}`
  );
  for (const o of candidates)
    console.log(`  ✓ ${o.cls.id} (${o.score}) → ${OUT_DIR}/farm_${o.cls.id}/`);
  for (const o of weak) console.log(`  ~ ${o.cls.id} (${o.score}) — refine the prompt or re-farm`);
  if (failed.length) {
    console.log(
      `\nUNCOVERED FAILURE CLASSES (knowledge/recipe targets, threads-style):`
    );
    for (const o of failed) console.log(`  ✗ ${o.cls.id} — ${o.detail}`);
  }
  console.log(
    `\nReview renders in ${OUT_DIR}/, then promote:\n` +
      `  npx tsx scripts/exemplar-farm/promote.ts farm_<id> [...]`
  );
}

void main();
