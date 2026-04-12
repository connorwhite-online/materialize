/**
 * One-off cleanup for file_assets rows whose `geometry_data.dimensions`
 * was persisted with non-numeric axes (e.g. {x: null, y: null, z: null})
 * — a shape CraftCloud occasionally returned before we added the
 * normalize at the cache-model boundary. Read paths assume all three
 * axes are numbers and crash with `e.toFixed is not a function`.
 *
 * Run with:
 *   bun run scripts/cleanup-bad-dimensions.ts
 *
 * Bun autoloads `.env` and `.env.local`, so DATABASE_URL just works.
 */

import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL — set it in .env / .env.local before running"
    );
  }
  const sql = neon(url);

  const before = (await sql`
    SELECT count(*)::int AS n FROM file_assets
    WHERE geometry_data ? 'dimensions'
      AND (
        jsonb_typeof(geometry_data->'dimensions'->'x') <> 'number'
        OR jsonb_typeof(geometry_data->'dimensions'->'y') <> 'number'
        OR jsonb_typeof(geometry_data->'dimensions'->'z') <> 'number'
      )
  `) as { n: number }[];
  const count = before[0]?.n ?? 0;
  console.log(`Rows with malformed dimensions: ${count}`);

  if (count === 0) {
    console.log("Nothing to clean.");
    return;
  }

  await sql`
    UPDATE file_assets
    SET geometry_data = geometry_data - 'dimensions'
    WHERE geometry_data ? 'dimensions'
      AND (
        jsonb_typeof(geometry_data->'dimensions'->'x') <> 'number'
        OR jsonb_typeof(geometry_data->'dimensions'->'y') <> 'number'
        OR jsonb_typeof(geometry_data->'dimensions'->'z') <> 'number'
      )
  `;

  console.log(`Cleaned ${count} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
