// CAD generation flight-recorder dump: prints a job's full trail — status,
// route, real error detail, usage, and every persisted progress event —
// so a failed generation is diagnosed from the DB record instead of hoping
// the dev console hasn't rotated.
//
//   npx tsx scripts/cad-job-dump.ts             # last 5 jobs, summary
//   npx tsx scripts/cad-job-dump.ts <jobId>     # one job, full trail
//   npx tsx scripts/cad-job-dump.ts --latest 10 # last N jobs, summary
//
// Reads DATABASE_URL from the environment, falling back to .env.local the
// same way scripts/db-migrate.ts does.
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

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

const sql = neon(process.env.DATABASE_URL ?? "");

interface JobRow {
  id: string;
  status: string;
  error: string | null;
  error_detail: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
  usage: unknown;
  cost_cents: number | null;
  progress: Array<Record<string, unknown>>;
  gen_status: string | null;
  gen_error: string | null;
  prompt: string | null;
}

const JOB_SELECT = `
  select j.id, j.status, j.error, j.error_detail, j.created_at, j.started_at,
         j.finished_at, j.updated_at, j.usage, j.cost_cents, j.progress,
         g.status as gen_status, g.error as gen_error, g.prompt
  from cad_jobs j
  left join cad_generations g on g.id = j.generation_id`;

function fmtEvent(p: Record<string, unknown>): string {
  // Renders are enormous base64 blobs — drop them, keep everything else.
  const { render, ...rest } = p;
  void render;
  return JSON.stringify(rest);
}

function printSummary(j: JobRow): void {
  const dur =
    j.started_at && j.finished_at
      ? `${Math.round((+new Date(j.finished_at) - +new Date(j.started_at)) / 1000)}s`
      : j.started_at
        ? `running ${Math.round((Date.now() - +new Date(j.started_at)) / 1000)}s`
        : "-";
  const route = j.progress.find((p) => p.type === "route") as
    | { route?: string }
    | undefined;
  const fallback = j.progress.some((p) => p.type === "fallback");
  console.log(
    `${j.id}  ${j.status.padEnd(9)} ${dur.padStart(9)}  route=${route?.route ?? "?"}${fallback ? "+fallback" : ""}  events=${j.progress.length}`
  );
  console.log(`  prompt: ${(j.prompt ?? "").slice(0, 100)}`);
  if (j.error) console.log(`  error: ${j.error}`);
  if (j.error_detail) {
    console.log(`  detail: ${j.error_detail.split("\n")[0].slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (arg && !arg.startsWith("--")) {
    const rows = (await sql`${sql.unsafe(JOB_SELECT)} where j.id = ${arg}`) as unknown as JobRow[];
    if (rows.length === 0) {
      console.error(`no cad_jobs row with id ${arg}`);
      process.exit(1);
    }
    const j = rows[0];
    printSummary(j);
    console.log(
      `  created=${j.created_at} started=${j.started_at} finished=${j.finished_at} heartbeat=${j.updated_at}`
    );
    console.log(`  gen: status=${j.gen_status} error=${j.gen_error ?? "-"}`);
    if (j.usage) console.log(`  usage: ${JSON.stringify(j.usage)}`);
    if (j.cost_cents != null) console.log(`  costCents: ${j.cost_cents}`);
    if (j.error_detail) {
      console.log("  --- error detail ---");
      console.log(
        j.error_detail
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      );
    }
    console.log(`  --- progress (${j.progress.length} events) ---`);
    for (const p of j.progress) console.log(`  ${fmtEvent(p)}`);
    return;
  }

  const n = arg === "--latest" ? Number(process.argv[3] ?? 5) : 5;
  const rows = (await sql`${sql.unsafe(JOB_SELECT)} order by j.created_at desc limit ${n}`) as unknown as JobRow[];
  for (const j of rows) {
    printSummary(j);
    console.log("");
  }
  if (rows.length > 0) {
    console.log(`full trail: npx tsx scripts/cad-job-dump.ts <jobId>`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
