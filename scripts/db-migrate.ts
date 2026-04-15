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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);
  const db = drizzle(sql);

  console.log("Running migrations from lib/db/migrations…");
  await migrate(db, { migrationsFolder: "lib/db/migrations" });
  console.log("Migrations up to date.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
