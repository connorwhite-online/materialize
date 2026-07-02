/**
 * One-off backfill for cad_threads (docs/text-to-cad/05 §A, MTR-178).
 *
 * Groups existing cad_generations into design threads by walking the
 * parent_generation_id chain to each row's root, creates one cad_threads
 * row per group (title = the root's title, root_generation_id = the
 * root, active_generation_id = the group's latest SUCCEEDED generation,
 * created_at/updated_at matching the group's history), and stamps
 * thread_id on every generation in the group.
 *
 * Idempotent:
 *   - Generations that already have thread_id are skipped.
 *   - If a group's root already carries a thread (e.g. the lazy-create
 *     path in lib/cad/persist.ts got there first), remaining members are
 *     stamped with that thread instead of a new one.
 *
 * Once this has run in production, the legacy threadId-IS-NULL fallback
 * in app/(app)/prometheus/page.tsx can be retired.
 *
 * Run with:
 *   npx tsx scripts/backfill-cad-threads.ts
 *   npx tsx scripts/backfill-cad-threads.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// Lift DATABASE_URL out of .env.local when running directly via
// tsx/npm (Next.js only auto-loads it for framework contexts).
// Same pattern as scripts/db-migrate.ts.
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

const DRY_RUN = process.argv.includes("--dry-run");

interface GenRow {
  id: string;
  user_id: string;
  parent_generation_id: string | null;
  thread_id: string | null;
  title: string | null;
  status: string;
  created_at: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL — set it in .env / .env.local before running"
    );
  }
  const sql = neon(url);

  const rows = (await sql`
    SELECT id, user_id, parent_generation_id, thread_id, title, status, created_at
    FROM cad_generations
    ORDER BY created_at ASC
  `) as GenRow[];

  console.log(`Loaded ${rows.length} generations`);

  const byId = new Map(rows.map((r) => [r.id, r]));

  // Root of a generation = the earliest ancestor reachable via
  // parent_generation_id (cycle-guarded; a missing parent row terminates
  // the walk at the last known ancestor). Memoized per row.
  const rootCache = new Map<string, string>();
  const rootOf = (row: GenRow): string => {
    const cached = rootCache.get(row.id);
    if (cached) return cached;
    let cur = row;
    const seen = new Set<string>([cur.id]);
    while (cur.parent_generation_id) {
      const parent = byId.get(cur.parent_generation_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      cur = parent;
    }
    for (const id of seen) rootCache.set(id, cur.id);
    return cur.id;
  };

  // Group EVERY generation by root; membership drives both thread reuse
  // (a root that already has a thread adopts its whole group) and thread
  // creation.
  const groups = new Map<string, GenRow[]>();
  for (const row of rows) {
    const root = rootOf(row);
    const group = groups.get(root);
    if (group) group.push(row);
    else groups.set(root, [row]);
  }

  let createdThreads = 0;
  let stampedGenerations = 0;
  let skippedGroups = 0;

  for (const [rootId, members] of groups) {
    const unstamped = members.filter((m) => !m.thread_id);
    if (unstamped.length === 0) {
      skippedGroups++;
      continue; // fully migrated already — idempotency skip
    }

    const root = byId.get(rootId)!;

    // Reuse a thread any member already carries (lazy-create in persist may
    // have adopted the root before this script ran); prefer the root's own.
    let threadId =
      root.thread_id ?? members.find((m) => m.thread_id)?.thread_id ?? null;

    if (!threadId) {
      const succeeded = members.filter((m) => m.status === "succeeded");
      const active = succeeded.length
        ? succeeded[succeeded.length - 1] // rows are created_at ASC
        : null;
      const last = members[members.length - 1];

      if (DRY_RUN) {
        console.log(
          `[dry-run] would create thread for root ${rootId} ` +
            `(${members.length} generations, title=${JSON.stringify(
              root.title
            )}, active=${active?.id ?? "none"})`
        );
        createdThreads++;
        stampedGenerations += unstamped.length;
        continue;
      }

      const [thread] = (await sql`
        INSERT INTO cad_threads
          (user_id, title, root_generation_id, active_generation_id, created_at, updated_at)
        VALUES
          (${root.user_id}, ${root.title}, ${root.id}, ${active?.id ?? null},
           ${root.created_at}, ${last.created_at})
        RETURNING id
      `) as { id: string }[];
      threadId = thread.id;
      createdThreads++;
    } else if (DRY_RUN) {
      console.log(
        `[dry-run] would stamp ${unstamped.length} generations onto existing thread ${threadId}`
      );
      stampedGenerations += unstamped.length;
      continue;
    }

    const ids = unstamped.map((m) => m.id);
    await sql`
      UPDATE cad_generations
      SET thread_id = ${threadId}
      WHERE id = ANY(${ids}) AND thread_id IS NULL
    `;
    stampedGenerations += ids.length;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}threads created: ${createdThreads}, ` +
      `generations stamped: ${stampedGenerations}, groups already migrated: ${skippedGroups}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
