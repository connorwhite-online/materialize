/**
 * Judge-vs-human calibration scorecard (MTR-184). Reads scored + rated
 * generations from cadGenerations and correlates the VLM judge's aggregate and
 * per-dimension scores against the owner's 👍/👎 rating. A weak or negative
 * correlation on a dimension means that rubric line disagrees with taste —
 * rewrite it in lib/cad/critique-core.ts before the repair loop keeps spending
 * on it.
 *
 * Slices by judge model (configFingerprint.models.critique) so a model swap on
 * the `critique` role is attributable.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/evals/calibration.ts
 *
 * The correlation math is the pure, unit-tested oracle in
 * lib/cad/critique-calibration.ts — this script is only the DB read + print.
 */
import { and, isNotNull, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { cadGenerations } from "../../lib/db/schema";
import {
  correlateJudgeVsHuman,
  type CalibrationReport,
  type CalibrationSample,
  type MetricCorrelation,
} from "../../lib/cad/critique-calibration";

function fmtCorr(c: MetricCorrelation): string {
  const r = c.correlation == null ? "  —  " : c.correlation.toFixed(2).padStart(5);
  const mg = c.meanWhenGood == null ? "—" : c.meanWhenGood.toFixed(1);
  const mb = c.meanWhenBad == null ? "—" : c.meanWhenBad.toFixed(1);
  const flag =
    c.correlation != null && c.correlation < 0.2 && c.n >= 8 ? "  ⚠ weak/negative — revisit rubric" : "";
  return `${c.metric.padEnd(16)} r=${r}  n=${String(c.n).padStart(4)}  👍${mg} / 👎${mb}${flag}`;
}

function printReport(label: string, rep: CalibrationReport): void {
  console.log(`\n=== ${label} ===`);
  console.log(
    `rated rows: ${rep.ratedRows} (👍 ${rep.goodRows} / 👎 ${rep.badRows})`
  );
  if (rep.ratedRows < 2) {
    console.log("(not enough rated rows to correlate)");
    return;
  }
  console.log(fmtCorr(rep.aggregate));
  for (const d of rep.perDimension) console.log(fmtCorr(d));
}

async function main() {
  // Only rows the owner rated AND the judge scored are usable.
  const rows = await db
    .select({
      rating: cadGenerations.rating,
      aestheticScore: cadGenerations.aestheticScore,
      aestheticDims: cadGenerations.aestheticDims,
      configFingerprint: cadGenerations.configFingerprint,
    })
    .from(cadGenerations)
    .where(
      and(
        isNotNull(cadGenerations.rating),
        inArray(cadGenerations.rating, ["good", "bad"])
      )
    );

  const samples: CalibrationSample[] = rows.map((r) => {
    const fp = r.configFingerprint as { models?: { critique?: string | null } } | null;
    return {
      rating: r.rating,
      aestheticScore: r.aestheticScore,
      aestheticDims: r.aestheticDims as CalibrationSample["aestheticDims"],
      judgeModel: fp?.models?.critique ?? null,
    };
  });

  if (samples.length === 0) {
    console.log("No rated generations yet — nothing to calibrate.");
    return;
  }

  printReport("All judge models", correlateJudgeVsHuman(samples));

  // Per-judge-model slices (configFingerprint.models.critique).
  const byModel = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const key = s.judgeModel ?? "(unknown)";
    (byModel.get(key) ?? byModel.set(key, []).get(key)!).push(s);
  }
  if (byModel.size > 1) {
    for (const [model, subset] of byModel) {
      printReport(`Judge model: ${model}`, correlateJudgeVsHuman(subset));
    }
  }

  console.log(
    "\nReading: r > ~0.3 = the dimension tracks human taste; r near 0 or negative" +
      " on a well-populated dimension (n ≥ 8) = rewrite that rubric line."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
