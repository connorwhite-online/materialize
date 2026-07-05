/**
 * Failure miner CLI (MTR-186): cluster recurring text-to-CAD generation
 * failures into a human review queue of candidate repair hints.
 *
 * Reads only already-persisted cad_generations error/sourceCode data —
 * additive, offline, never touches the harness hot path. Nothing is
 * auto-injected: approved hints are landed by hand in repairHintFor().
 *
 * Run with:
 *   npx tsx scripts/cad-failure-miner.ts
 *   npx tsx scripts/cad-failure-miner.ts --since-days 30 --min-count 5
 *   npx tsx scripts/cad-failure-miner.ts --draft   # + model-drafted hints
 *   npx tsx scripts/cad-failure-miner.ts --out review-queue.json
 */

import fs from "node:fs";
import path from "node:path";

// Lift DATABASE_URL (and model creds) out of .env.local when run directly —
// Next only auto-loads it for framework contexts. Same pattern as
// scripts/backfill-cad-threads.ts.
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const { mineFailures } = await import("@/lib/cad/analysis/failure-miner");

  const report = await mineFailures({
    sinceDays: flag("since-days") ? Number(flag("since-days")) : undefined,
    minClusterCount: flag("min-count") ? Number(flag("min-count")) : undefined,
    limit: flag("limit") ? Number(flag("limit")) : undefined,
    draftHints: has("draft"),
  });

  console.log(
    `Scanned ${report.scannedRows} rows · ${report.totalFailures} failures · ` +
      `${report.clusterCount} clusters\n`
  );

  console.log(`=== Candidate hints (uncovered, human review) ===`);
  if (report.candidates.length === 0) {
    console.log("(none above threshold)\n");
  }
  for (const c of report.candidates) {
    const eff = c.efficacy
      ? ` · repair rate ${(100 * (c.efficacy.rate ?? 0)).toFixed(0)}% ` +
        `(${c.efficacy.repaired}/${c.efficacy.attempts})`
      : "";
    console.log(`\n[${c.count}×]${eff}  ${c.signature}`);
    console.log(`  e.g. ${c.representative}`);
    if (c.draftedHint) console.log(`  draft hint → ${c.draftedHint}`);
  }

  console.log(`\n=== Already covered (efficacy — rotate stale hints) ===`);
  for (const c of report.covered) {
    const eff = c.efficacy
      ? `${(100 * (c.efficacy.rate ?? 0)).toFixed(0)}% (${c.efficacy.repaired}/${c.efficacy.attempts})`
      : "no follow-up attempts";
    console.log(`[${c.count}×] repair ${eff}  ${c.signature}`);
  }

  const out = flag("out");
  if (out) {
    fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(report, null, 2));
    console.log(`\nWrote review queue → ${out}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
