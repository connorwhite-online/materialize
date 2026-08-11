// CAD generation flight-recorder dump: prints a job's full trail — status,
// route, real error detail, usage, and every persisted progress event —
// so a failed generation is diagnosed from the DB record instead of hoping
// the dev console hasn't rotated.
//
//   npx tsx scripts/cad-job-dump.ts                          # last 5 jobs, summary
//   npx tsx scripts/cad-job-dump.ts <jobId>                  # one job, full trail
//   npx tsx scripts/cad-job-dump.ts <jobId> --transcript     # + flight-recorder transcript (summary)
//   npx tsx scripts/cad-job-dump.ts <jobId> --transcript-full # + full prompts/responses/code
//   npx tsx scripts/cad-job-dump.ts --latest 10              # last N jobs, summary
//
// Reads DATABASE_URL from the environment, falling back to .env.local the
// same way scripts/db-migrate.ts does.
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
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
  transcript_storage_key: string | null;
  gen_status: string | null;
  gen_error: string | null;
  prompt: string | null;
}

const JOB_SELECT = `
  select j.id, j.status, j.error, j.error_detail, j.created_at, j.started_at,
         j.finished_at, j.updated_at, j.usage, j.cost_cents, j.progress,
         j.transcript_storage_key,
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

// --- Flight-recorder transcript (lib/cad/transcript.ts) -------------------
// Fetched straight from R2 with the same env credentials the app uses;
// gunzipped here because getObjectBytes-style S3 reads return the stored
// (gzipped) bytes, unlike a browser hitting the presigned URL.

interface TranscriptEvent {
  kind: string;
  t: number;
  role?: string;
  model?: string;
  prompt?: string;
  response?: string;
  imageLabels?: string[];
  source?: string;
  code?: string;
  ok?: boolean;
  error?: string | null;
  render?: string | null;
  messages?: unknown;
  ms?: number;
}

async function fetchTranscript(key: string): Promise<{
  systems: string[];
  events: TranscriptEvent[];
  truncated: boolean;
} | null> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("  (transcript fetch skipped: R2_* env vars not set)");
    return null;
  }
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const raw = await res.Body?.transformToByteArray();
  if (!raw) return null;
  // Stored gzipped (Content-Encoding) — S3-API reads get the raw bytes.
  const text = (() => {
    try {
      return gunzipSync(Buffer.from(raw)).toString("utf8");
    } catch {
      return Buffer.from(raw).toString("utf8");
    }
  })();
  return JSON.parse(text);
}

function printTranscript(
  tr: { systems: string[]; events: TranscriptEvent[]; truncated: boolean },
  full: boolean
): void {
  console.log(
    `  --- transcript (${tr.events.length} events, ${tr.systems.length} system prompt(s)${tr.truncated ? ", TRUNCATED" : ""}) ---`
  );
  const clip = (s: string | undefined | null, n: number) =>
    !s ? "" : full ? s : s.length > n ? `${s.slice(0, n)}…` : s;
  for (const e of tr.events) {
    const at = `t+${Math.round((e.t ?? 0) / 1000)}s`;
    if (e.kind === "model") {
      console.log(
        `  [${at}] MODEL ${e.role} (${e.model}, ${e.ms}ms) images=[${(e.imageLabels ?? []).join(" | ")}]`
      );
      console.log(`    prompt: ${clip(e.prompt, 300)}`);
      console.log(`    response: ${clip(e.response, 300)}`);
    } else if (e.kind === "exec") {
      console.log(
        `  [${at}] EXEC ${e.source} ok=${e.ok} render=${e.render ? "yes" : "no"}${e.error ? ` error=${clip(e.error, 200)}` : ""}`
      );
      if (full && e.code) {
        console.log(e.code.split("\n").map((l) => `    | ${l}`).join("\n"));
      }
    } else if (e.kind === "agentic") {
      const turns = Array.isArray(e.messages) ? e.messages.length : "?";
      console.log(`  [${at}] AGENTIC message log (${turns} turns)`);
      if (full) console.log(JSON.stringify(e.messages, null, 2));
    }
  }
  if (full) {
    console.log(`  --- system prompts ---`);
    tr.systems.forEach((sys, i) =>
      console.log(`  [system ${i}] ${sys.length} chars\n${sys}`)
    );
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
    const wantsTranscript =
      process.argv.includes("--transcript") ||
      process.argv.includes("--transcript-full");
    if (j.transcript_storage_key) {
      if (wantsTranscript) {
        const tr = await fetchTranscript(j.transcript_storage_key);
        if (tr) {
          printTranscript(tr, process.argv.includes("--transcript-full"));
        }
      } else {
        console.log(
          `  transcript: ${j.transcript_storage_key} (re-run with --transcript or --transcript-full)`
        );
      }
    } else if (wantsTranscript) {
      console.log("  (no transcript recorded for this job)");
    }
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
