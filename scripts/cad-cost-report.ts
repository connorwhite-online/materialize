/**
 * Studio cost report CLI (MTR-181): per-route and per-fingerprint generation
 * costs from the metering substrate (cad_jobs.usage), recomputed at the
 * CAD_PRICE_* unit prices currently in the environment — so re-running with
 * different prices re-prices the same history. With all prices at their 0
 * defaults the token/wall-time aggregates are the signal.
 *
 * Additive/offline — reads only, never touches the harness hot path. The
 * loader (lib/cad/analysis/cost-rollup.ts) can equally back a scorecard
 * "costs" section (deferred here: the eval page is shared surface).
 *
 * Run with:
 *   npx tsx scripts/cad-cost-report.ts --user <clerkUserId>
 *   npx tsx scripts/cad-cost-report.ts --user <id> --since-days 30 --out costs.json
 */

import fs from "node:fs";
import path from "node:path";

import type { CostBucket } from "@/lib/cad/analysis/cost-rollup";

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

const cents = (n: number) => `$${(n / 100).toFixed(2)}`;
const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${(n / 1000).toFixed(1)}k`;

async function main() {
  const userId = flag("user");
  if (!userId) {
    console.error("Usage: tsx scripts/cad-cost-report.ts --user <clerkUserId>");
    process.exit(2);
  }

  const { loadCostRollup } = await import("@/lib/cad/analysis/cost-rollup");
  const report = await loadCostRollup({
    userId,
    sinceDays: flag("since-days") ? Number(flag("since-days")) : undefined,
  });

  console.log(
    `${report.jobs} jobs (${report.unmeteredJobs} pre-metering) · ` +
      `total ${cents(report.totalCostCents)} at current CAD_PRICE_* env\n`
  );

  const printRows = (rows: CostBucket[], label: string) => {
    console.log(`=== Cost by ${label} ===`);
    for (const r of rows) {
      console.log(
        `\n${label}: ${r.key}\n` +
          `  jobs ${r.jobs} · cost ${cents(r.costCents)} ` +
          `(snapshot ${cents(r.snapshotCostCents)}) · ` +
          `avg ${cents(r.jobs ? r.costCents / r.jobs : 0)}/job\n` +
          `  tokens in ${tokens(r.inputTokens)} / out ${tokens(r.outputTokens)} · ` +
          `model calls ${r.modelCalls} (${Math.round(r.modelMs / 1000)}s) · ` +
          `sidecar ${Math.round(r.sidecarMs / 1000)}s · fal ${r.falCalls}`
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
    console.log(`Wrote report → ${out}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
