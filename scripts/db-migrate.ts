// Applies any unapplied migrations in lib/db/migrations/ to the
// DATABASE_URL. Invoked by `npm run db:migrate` locally and by the
// Vercel build command in production.
//
// Uses the neon-http migrator because the rest of the app already
// speaks to Neon over HTTP (see lib/db/index.ts). Drizzle tracks
// applied migrations in drizzle.__drizzle_migrations and skips
// anything whose created_at is <= the latest row there.
//
// Locally we pull DATABASE_URL from .env.local if the env var isn't
// already set (e.g. when run directly by `npm run build`). On
// Vercel the env var is injected by the platform so the fallback is
// a no-op.
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      const value = rawValue.replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

/** Host of the target database, for the log line. Never prints credentials. */
function targetLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

/**
 * Which migrations the DB has already recorded, newest first. Drizzle stores
 * the journal's `when` as created_at and applies anything greater than the
 * newest recorded value (see drizzle-orm/neon-http/migrator).
 */
async function appliedMillis(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
): Promise<number> {
  try {
    const rows = (await sql`
      SELECT created_at FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC LIMIT 1
    `) as { created_at: string | number }[];
    return rows.length ? Number(rows[0].created_at) : -1;
  } catch {
    return -1; // table does not exist yet — first ever run
  }
}

function journalEntries(): { tag: string; when: number }[] {
  const journal = JSON.parse(
    fs.readFileSync(
      path.resolve("lib/db/migrations/meta/_journal.json"),
      "utf8"
    )
  ) as { entries: { tag: string; when: number }[] };
  return journal.entries;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);
  const db = drizzle(sql);

  // SAY WHAT WILL HAPPEN, AND TO WHICH DATABASE. This used to print
  // "Running migrations…" then "Migrations up to date." unconditionally, so
  // a run that applied a migration and a run that skipped everything looked
  // IDENTICAL. That ambiguity cost a production debug session: a missing
  // column was 500ing every generation, and the operator could not tell
  // whether the fix had landed or the script had no-opped.
  const before = await appliedMillis(sql);
  const pending = journalEntries().filter((e) => e.when > before);
  console.log(`Target: ${targetLabel(url)}`);
  console.log(
    pending.length === 0
      ? "Nothing pending — every migration in the journal is already recorded."
      : `Pending (${pending.length}): ${pending.map((e) => e.tag).join(", ")}`
  );

  await migrate(db, { migrationsFolder: "lib/db/migrations" });

  const after = await appliedMillis(sql);
  const applied = journalEntries().filter(
    (e) => e.when > before && e.when <= after
  );
  console.log(
    applied.length === 0
      ? "Done — nothing applied."
      : `Done — applied ${applied.length}: ${applied.map((e) => e.tag).join(", ")}`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
