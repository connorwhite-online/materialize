/**
 * Implicit-signal outcomes rollup CLI (MTR-185): print per-route and
 * per-fingerprint outcome metrics (save rate, abandon rate, revisions to
 * save, frustration proxy, print-through, aesthetic, remesh) from
 * already-persisted cad_threads + cad_generations + print orders.
 *
 * Additive/offline — reads only, never touches the harness hot path. The pure
 * aggregation in lib/cad/analysis/implicit-signals.ts can equally back a
 * scorecard "outcomes" section (deferred here to avoid touching the shared
 * eval page under a sibling PR).
 *
 * Run with:
 *   npx tsx scripts/cad-outcomes-rollup.ts --user <clerkUserId>
 *   npx tsx scripts/cad-outcomes-rollup.ts --user <id> --since-days 30 --out outcomes.json
 */

import fs from "node:fs";
import path from "node:path";

import type { OutcomesRollup } from "@/lib/cad/analysis/outcomes-rollup";

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

function pctOrDash(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

async function main() {
  const userId = flag("user");
  if (!userId) {
    console.error("Usage: tsx scripts/cad-outcomes-rollup.ts --user <clerkUserId>");
    process.exit(2);
  }

  const { loadOutcomesRollup } = await import(
    "@/lib/cad/analysis/outcomes-rollup"
  );
  const report = await loadOutcomesRollup({
    userId,
    sinceDays: flag("since-days") ? Number(flag("since-days")) : undefined,
  });

  console.log(
    `${report.threads} threads · ${report.generations} generations\n`
  );

  const printRows = (rows: OutcomesRollup["byRoute"], label: string) => {
    console.log(`=== Outcomes by ${label} ===`);
    for (const r of rows) {
      console.log(
        `\n${label}: ${r.key}\n` +
          `  threads ${r.threads} · save ${pctOrDash(r.saveRate)} · ` +
          `abandon ${pctOrDash(r.abandonRate)} · ` +
          `print-through ${pctOrDash(r.printThroughRate)}\n` +
          `  avg gens/save ${fmt(r.avgGenerationsToSave)} · ` +
          `revise-after-success ${r.reviseAfterSuccess} · ` +
          `aesthetic ${fmt(r.avgAesthetic)} · ` +
          `remesh ${pctOrDash(r.remeshRate)}`
      );
    }
    console.log("");
  };

  printRows(report.byRoute, "route");
  printRows(report.byFingerprint, "fingerprint");

  const out = flag("out");
  if (out) {
    fs.writeFileSync(
      path.resolve(process.cwd(), out),
      JSON.stringify(report, null, 2)
    );
    console.log(`Wrote rollup → ${out}`);
  }
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
