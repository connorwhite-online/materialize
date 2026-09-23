/**
 * One-command health check for the text-to-CAD stack: is the sidecar the
 * image we think it is, and what happened to the recent generations?
 *
 * Exists because answering "is the CAD studio working?" has repeatedly meant
 * running three tools with three different ways of finding credentials, and
 * getting the shell quoting wrong on at least one. This reads .env.local
 * itself (the same way the other scripts do) and needs no exported vars.
 *
 * Read-only. Talks to neon and the sidecar directly, so it carries no
 * `server-only` import chain and needs no --conditions flag.
 *
 * Run with:
 *   npx tsx scripts/cad-status.ts
 *   npx tsx scripts/cad-status.ts --limit 20
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

for (const line of (() => {
  const p = path.resolve(process.cwd(), ".env.local");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n") : [];
})()) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const LIMIT = Number(flag("limit") ?? 12);

interface Row {
  id: string;
  created_at: string;
  status: string;
  engine: string | null;
  attempts: number;
  prompt: string;
  gen_error: string | null;
  job_status: string | null;
  error_detail: string | null;
  route: string | null;
  started_at: string | null;
  finished_at: string | null;
}

async function sidecar(): Promise<void> {
  const url = process.env.CAD_RUNNER_URL;
  console.log("── Sidecar ──────────────────────────────────────────────");
  if (!url) {
    console.log("  CAD_RUNNER_URL not set (mock mode — no real geometry)\n");
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`  ${new URL(url).host} → HTTP ${res.status}. NOT HEALTHY.\n`);
      return;
    }
    const h = (await res.json()) as {
      rev?: string;
      modules?: Record<string, boolean>;
      degraded?: string[];
    };
    console.log(`  host     ${new URL(url).host}`);
    console.log(`  rev      ${h.rev ?? "unknown"}   (commit the image was built from)`);
    const degraded = h.degraded ?? [];
    console.log(
      degraded.length
        ? `  DEGRADED ${degraded.join(", ")} — these modules failed to import`
        : `  modules  all present (${Object.keys(h.modules ?? {}).length} probed)`
    );
    // The SDF engine cannot run without these two.
    for (const need of ["sdf_kit", "dfm"]) {
      const present = h.modules?.[need];
      if (present === undefined) {
        console.log(`  note     '${need}' not probed — sidecar predates the check`);
      } else if (!present) {
        console.log(`  note     '${need}' MISSING — the SDF engine cannot run`);
      }
    }
    console.log();
  } catch (err) {
    console.log(`  unreachable: ${(err as Error).message}\n`);
  }
}

async function generations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  console.log("── Recent generations ───────────────────────────────────");
  if (!url) {
    console.log("  DATABASE_URL not set\n");
    return;
  }
  const sql = neon(url);
  console.log(`  db ${new URL(url).host}\n`);
  const rows = (await sql`
    SELECT g.id, g.created_at, g.status, g.engine, g.attempts, g.prompt,
           g.error AS gen_error, j.status AS job_status, j.error_detail,
           j.usage ->> 'route' AS route, j.started_at, j.finished_at
    FROM cad_generations g
    LEFT JOIN cad_jobs j ON j.generation_id = g.id
    ORDER BY g.created_at DESC
    LIMIT ${LIMIT}
  `) as Row[];

  if (rows.length === 0) {
    console.log("  no generations at all\n");
    return;
  }
  for (const r of rows) {
    const secs =
      r.started_at && r.finished_at
        ? `${Math.round(
            (new Date(r.finished_at).getTime() -
              new Date(r.started_at).getTime()) / 1000
          )}s`
        : r.started_at
          ? "running"
          : "—";
    const when = new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16);
    console.log("─".repeat(72));
    console.log(
      `${when}  ${secs.padStart(7)}  gen=${r.status}  job=${r.job_status ?? "?"}  ` +
        `engine=${r.engine ?? "?"}  route=${r.route ?? "?"}  attempts=${r.attempts}`
    );
    console.log(`  prompt : ${r.prompt.replace(/\s+/g, " ").slice(0, 100)}`);
    if (r.status !== "succeeded") {
      console.log(`  shown  : ${(r.gen_error ?? "(none)").replace(/\s+/g, " ").slice(0, 120)}`);
      console.log(
        `  REAL   : ${
          r.error_detail
            ? r.error_detail.split("\n").slice(0, 6).join("\n           ")
            : "(no error_detail)"
        }`
      );
    }
  }
  console.log("─".repeat(72));
  const ok = rows.filter((r) => r.status === "succeeded").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  console.log(
    `\n  ${ok}/${rows.length} succeeded · ${pending} still pending · ` +
      `${rows.length - ok - pending} failed\n`
  );
}

async function main() {
  console.log();
  await sidecar();
  await generations();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
