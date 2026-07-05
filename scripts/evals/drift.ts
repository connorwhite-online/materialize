/**
 * Judge drift gate (MTR-184, doc 07 §B). Re-judges a frozen fixture set with
 * the SAME rubric + parser the harness uses (critique-core) and fails when the
 * live judge drifts past tolerance from the hand-assigned baselines in
 * fixtures/drift-baselines.json — insurance for a model upgrade on the
 * `critique` role.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... (or CLAUDE_CODE_OAUTH_TOKEN=...) tsx scripts/evals/drift.ts
 *   CAD_AESTHETIC_JUDGE_MODEL=claude-opus-4-8  # judge model under test
 *   CAD_DRIFT_AGGREGATE_TOL=8  CAD_DRIFT_DIM_TOL=1
 *
 * Fixture renders live at fixtures/renders/<id>.png (base64-judged one at a
 * time, same as the harness single-part packet). A fixture without a render is
 * reported as PENDING and does not fail the gate — the render PNGs are produced
 * by the sidecar (Docker/CI), which this env can't run.
 *
 * Exit code is non-zero on real drift so CI can gate on it.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { CRITIQUE_RUBRIC, parseJudgement } from "../../lib/cad/critique-core";
import {
  driftCheck,
  type FixtureBaseline,
  type FixtureLive,
} from "../../lib/cad/critique-calibration";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures");
const RENDER_DIR = join(FIXTURE_DIR, "renders");

const JUDGE_MODEL = process.env.CAD_AESTHETIC_JUDGE_MODEL || "claude-opus-4-8";
const AGG_TOL = Number(process.env.CAD_DRIFT_AGGREGATE_TOL) || 8;
const DIM_TOL = Number(process.env.CAD_DRIFT_DIM_TOL) || 1;

interface BaselineFile {
  fixtures: (FixtureBaseline & { note?: string })[];
}

function makeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey
    ? new Anthropic({ apiKey })
    : new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN });
}

async function judgeFixture(
  client: Anthropic,
  id: string,
  pngBase64: string
): Promise<FixtureLive | null> {
  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    system: CRITIQUE_RUBRIC,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Requested object: a 3D-printable part (fixture ${id})` },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: pngBase64 },
          },
        ],
      },
    ],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJudgement(text);
  if (!parsed) return null;
  const dims: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed.perDimension)) dims[k] = v.score;
  return { id, aggregate: parsed.score, dims };
}

async function main() {
  const baselineFile = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "drift-baselines.json"), "utf8")
  ) as BaselineFile;
  const baselines = baselineFile.fixtures;

  const client = makeClient();
  const live: FixtureLive[] = [];
  const pending: string[] = [];

  for (const base of baselines) {
    const png = join(RENDER_DIR, `${base.id}.png`);
    if (!existsSync(png)) {
      pending.push(base.id);
      continue;
    }
    const b64 = readFileSync(png).toString("base64");
    try {
      const scored = await judgeFixture(client, base.id, b64);
      if (scored) live.push(scored);
      else console.error(`fixture ${base.id}: judge returned an unparseable response`);
    } catch (err) {
      console.error(`fixture ${base.id}: judge call failed — ${err}`);
    }
  }

  if (pending.length > 0) {
    console.log(
      `PENDING (no render yet — add fixtures/renders/<id>.png via the sidecar): ${pending.join(", ")}`
    );
  }

  // Only gate on fixtures that actually have a render + a live score.
  const active = baselines.filter((b) => !pending.includes(b.id));
  if (active.length === 0) {
    console.log(
      "\nNo active drift fixtures (renders not present in this env). Gate is a no-op until renders are added."
    );
    return;
  }

  const report = driftCheck(active, live, { aggregateTol: AGG_TOL, dimTol: DIM_TOL });
  console.log(
    `\n=== Judge drift [model: ${JUDGE_MODEL}, tol: ±${AGG_TOL}pts / ±${DIM_TOL}dim] ===`
  );
  for (const r of report.results) {
    const agg = r.aggregateDrift == null ? "—" : `${r.aggregateDrift.toFixed(1)}pts`;
    console.log(
      `${r.pass ? "OK  " : "DRIFT"} ${r.id.padEnd(24)} agg Δ${agg}` +
        (r.reasons.length ? `  — ${r.reasons.join("; ")}` : "")
    );
  }
  console.log(report.pass ? "\nAll active fixtures within tolerance." : "\nJudge DRIFTED — review the rubric / model change.");
  if (!report.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
