import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The neon-http migrator sends each `--> statement-breakpoint` chunk as one
 * prepared statement, and Postgres refuses more than one command per
 * prepared statement ("cannot insert multiple commands into a prepared
 * statement"). A hand-written migration that forgets the marker therefore
 * fails `db:migrate` — which runs first in every Vercel build, previews
 * included, so it fails the deploy. drizzle-kit adds the markers itself;
 * the hand-written 0039+ files are where they go missing.
 */

const MIGRATIONS = path.resolve(__dirname, "../migrations");

// Multi-statement files that are already applied in production, so their
// bytes (and drizzle's recorded hash) must not change. Listed, not fixed.
const GRANDFATHERED = new Set([
  "0063_file_preview_camera",
  "0065_print_order_is_test",
]);

/**
 * Statements in a chunk: semicolons that end a line, with comments and
 * dollar-quoted bodies (`DO $$ … $$`) stripped so a PL/pgSQL block counts
 * as the one statement it is.
 */
function statementCount(chunk: string): number {
  return chunk
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .filter((line) => line.endsWith(";")).length;
}

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")
) as { entries: { tag: string }[] };

describe("migration statement breakpoints", () => {
  it.each(
    journal.entries
      .map((e) => e.tag)
      .filter((tag) => Number(tag.slice(0, 4)) >= 39 && !GRANDFATHERED.has(tag))
  )("%s puts one statement per breakpoint chunk", (tag) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, `${tag}.sql`), "utf8");
    const crowded = sql
      .split("--> statement-breakpoint")
      .map(statementCount)
      .filter((n) => n > 1);
    expect(crowded, `${tag}.sql needs --> statement-breakpoint between statements`).toEqual([]);
  });
});
