/**
 * Failure-detail dump: the diagnostics scripts/cad-failure-miner.ts cannot see.
 *
 * The miner clusters `cad_generations.error`, which holds the SCRUBBED
 * user-facing copy ("Generation failed. Please try again."). The real
 * exception + stack + stage lives on `cad_jobs.error_detail` — a column that
 * exists precisely because scrubbing the message for the UI used to scrub it
 * for everyone (lib/db/schema.ts § cadJobs.error_detail) — and the miner never
 * joins to it. So the single biggest failure cluster reads as the opaque
 * string "generation failed" and tells you nothing.
 *
 * This joins the two and adds job wall-clock, which is what distinguishes a
 * kernel failure from a deadline kill: a run that dies at ~CAD_JOB_BUDGET_MS
 * (740s default) or ~maxDuration (800s) was killed by the clock, not by OCCT.
 *
 * Read-only. Talks to neon directly rather than through `@/lib/db`, so it
 * carries no `server-only` import chain and needs no --conditions flag
 * (same pattern as scripts/backfill-cad-threads.ts).
 *
 * Run with:
 *   npx tsx scripts/cad-failure-detail.ts
 *   npx tsx scripts/cad-failure-detail.ts --since-days 90 --full
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// Lift DATABASE_URL out of .env.local when running directly via tsx/npm
// (Next.js only auto-loads it for framework contexts).
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

const SINCE_DAYS = Number(flag("since-days") ?? 60);
const FULL = process.argv.includes("--full");
const DETAIL_CHARS = FULL ? 4000 : 600;

interface Row {
  id: string;
  created_at: string;
  engine: string | null;
  attempts: number;
  prompt: string;
  gen_error: string | null;
  job_status: string | null;
  job_error: string | null;
  error_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  route: string | null;
}

function secs(row: Row): number | null {
  if (!row.started_at || !row.finished_at) return null;
  const ms = new Date(row.finished_at).getTime() - new Date(row.started_at).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** A run that died near the job budget (740s) or platform cap (800s). */
function looksLikeDeadlineKill(s: number | null): boolean {
  return s !== null && s >= 600;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing DATABASE_URL — set it in .env.local before running");
  }
  const sql = neon(url);

  const rows = (await sql`
    SELECT
      g.id,
      g.created_at,
      g.engine,
      g.attempts,
      g.prompt,
      g.error                      AS gen_error,
      j.status                     AS job_status,
      j.error                      AS job_error,
      j.error_detail,
      j.started_at,
      j.finished_at,
      j.usage ->> 'route'          AS route
    FROM cad_generations g
    LEFT JOIN cad_jobs j ON j.generation_id = g.id
    WHERE g.status = 'failed'
      AND g.created_at > now() - make_interval(days => ${SINCE_DAYS})
    ORDER BY g.created_at DESC
  `) as Row[];

  console.log(`\n${rows.length} failed generations in the last ${SINCE_DAYS} days\n`);

  let deadlineKills = 0;
  let noDetail = 0;

  for (const row of rows) {
    const s = secs(row);
    if (looksLikeDeadlineKill(s)) deadlineKills += 1;
    if (!row.error_detail) noDetail += 1;

    const when = new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16);
    const dur = s === null ? "     ?" : `${String(s).padStart(4)}s`;
    const mark = looksLikeDeadlineKill(s) ? " ⏱ DEADLINE?" : "";

    console.log("─".repeat(78));
    console.log(
      `${when}  ${dur}${mark}  attempts=${row.attempts}  ` +
        `engine=${row.engine ?? "?"}  route=${row.route ?? "?"}  job=${row.job_status ?? "?"}`
    );
    console.log(`  prompt : ${row.prompt.replace(/\s+/g, " ").slice(0, 110)}`);
    console.log(`  shown  : ${(row.gen_error ?? "(none)").replace(/\s+/g, " ").slice(0, 110)}`);
    if (row.error_detail) {
      const detail = row.error_detail.slice(0, DETAIL_CHARS);
      console.log(`  REAL   : ${detail.split("\n").join("\n           ")}`);
    } else {
      console.log(`  REAL   : (no error_detail — job row missing or predates the column)`);
    }
  }

  console.log("─".repeat(78));
  console.log(
    `\nSummary: ${rows.length} failures · ` +
      `${deadlineKills} ran >=600s (deadline-kill shaped) · ` +
      `${noDetail} with no error_detail\n`
  );
  console.log("Re-run with --full for untruncated stacks.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
