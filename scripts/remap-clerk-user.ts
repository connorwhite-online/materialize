/**
 * Move a user's data from one Clerk user id to another.
 *
 * Why this exists: Clerk instances are isolated. Migrating from a
 * development instance to a production one does NOT carry accounts
 * over — the same person signing in on production gets a brand-new
 * `user_…` id. Every row in our database is keyed to the OLD id, so
 * after the migration their profile, files, orders, earnings, and
 * saved card are stranded on an orphaned row while a fresh empty row
 * is created under the new id. Their old handle also stays taken
 * (handles are checked against our DB, not Clerk), which blocks them
 * from reclaiming it during onboarding.
 *
 * This script merges the two rows and repoints every child record.
 *
 * ## Safety design
 *
 * Every FK to `users.id` in this schema is ON DELETE CASCADE (21 of
 * them at time of writing). Deleting the old row before repointing
 * would silently destroy the user's entire history. So:
 *
 *   1. Child tables are discovered from `information_schema` at
 *      runtime, never hand-listed — a hand-written list drifts the
 *      moment someone adds a table, and a missed table here means
 *      cascade-deleted data.
 *   2. The old row is deleted in a SECOND phase, only after a
 *      verification pass proves zero rows still reference it. If
 *      anything remains, the script stops and leaves the old row in
 *      place — an inert leftover row is trivially fixable, deleted
 *      orders are not.
 *   3. Dry-run is the default. Nothing is written without --apply.
 *
 * ## Merge rules
 *
 *   - `username`     — the OLD row wins. Reclaiming the handle is the
 *     whole point; the new row's handle is whatever placeholder they
 *     had to pick to escape onboarding.
 *   - `createdAt`    — the EARLIER of the two, preserving join date.
 *   - everything else — COALESCE(new, old): keep whatever the new row
 *     already has (display name and avatar are freshly populated from
 *     the OAuth provider and are better than the old values), and
 *     inherit from the old row only where the new row is empty. That
 *     rule carries over Stripe Connect payouts, the saved card, bio,
 *     social links, and notification preferences without ever
 *     clobbering fresher data.
 *
 * ## Usage
 *
 *   # dry run (default) — resolve the old row by handle
 *   bun run scripts/remap-clerk-user.ts --from-username connor --to user_NEW
 *
 *   # dry run — resolve by explicit old id
 *   bun run scripts/remap-clerk-user.ts --from user_OLD --to user_NEW
 *
 *   # execute
 *   bun run scripts/remap-clerk-user.ts --from-username connor --to user_NEW --apply
 *
 * Re-running after a successful apply is a no-op: the old row is gone,
 * so resolution fails with a clear message.
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// Lift DATABASE_URL out of .env.local when running directly via
// tsx/bun (Next.js only auto-loads it for framework contexts).
// Same pattern as scripts/db-migrate.ts.
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (match) {
        process.env.DATABASE_URL = match[1].replace(/^["']|["']$/g, "");
        break;
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (and no .env.local fallback found).");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const fromId = arg("from");
const fromUsername = arg("from-username");
const toId = arg("to");
const apply = process.argv.includes("--apply");

if (!toId || (!fromId && !fromUsername)) {
  console.error(
    "Usage: remap-clerk-user.ts (--from <old_user_id> | --from-username <handle>) --to <new_user_id> [--apply]"
  );
  process.exit(1);
}

interface UserRow {
  id: string;
  username: string | null;
  display_name: string | null;
  created_at: string;
  stripe_customer_id: string | null;
  stripe_account_id: string | null;
}

/** Every column in another table that points at users.id. */
interface ChildRef {
  table_name: string;
  column_name: string;
}

async function main() {
  // ---------------------------------------------------------------
  // Resolve both rows
  // ---------------------------------------------------------------
  const oldRows = (
    fromId
      ? await sql`SELECT id, username, display_name, created_at, stripe_customer_id, stripe_account_id
                  FROM users WHERE id = ${fromId}`
      : await sql`SELECT id, username, display_name, created_at, stripe_customer_id, stripe_account_id
                  FROM users WHERE username = ${fromUsername}`
  ) as UserRow[];

  if (oldRows.length === 0) {
    console.error(
      fromId
        ? `No user row with id ${fromId}.`
        : `No user row with username "${fromUsername}". (Already remapped? Check the handle.)`
    );
    process.exit(1);
  }
  const oldUser = oldRows[0];

  const newRows = (await sql`
    SELECT id, username, display_name, created_at, stripe_customer_id, stripe_account_id
    FROM users WHERE id = ${toId}
  `) as UserRow[];

  if (newRows.length === 0) {
    console.error(
      `No user row with id ${toId}. Sign in on the new instance first so the row exists, then re-run.`
    );
    process.exit(1);
  }
  const newUser = newRows[0];

  if (oldUser.id === newUser.id) {
    console.error("Old and new ids are the same — nothing to do.");
    process.exit(1);
  }

  console.log("\nOLD row (data source, will be removed):");
  console.table([oldUser]);
  console.log("NEW row (destination):");
  console.table([newUser]);

  // ---------------------------------------------------------------
  // Discover every FK column referencing users.id
  // ---------------------------------------------------------------
  const refs = (await sql`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'users'
      AND ccu.column_name = 'id'
    ORDER BY tc.table_name, kcu.column_name
  `) as ChildRef[];

  if (refs.length === 0) {
    console.error(
      "Found no foreign keys referencing users(id). Refusing to continue — " +
        "that result is almost certainly wrong, and proceeding risks a cascade delete."
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Report what would move
  // ---------------------------------------------------------------
  console.log(`\n${refs.length} referencing column(s) found. Rows to repoint:\n`);
  const plan: Array<{ table: string; column: string; rows: number }> = [];
  let total = 0;
  for (const ref of refs) {
    // Identifiers can't be parameterized; they come from
    // information_schema (not user input), and are quoted.
    const countRows = (await sql.query(
      `SELECT COUNT(*)::int AS n FROM "${ref.table_name}" WHERE "${ref.column_name}" = $1`,
      [oldUser.id]
    )) as Array<{ n: number }>;
    const n = countRows[0]?.n ?? 0;
    total += n;
    plan.push({ table: ref.table_name, column: ref.column_name, rows: n });
  }
  console.table(plan);
  console.log(`Total rows to repoint: ${total}`);
  console.log(`Handle to transfer: ${oldUser.username ?? "(none)"}\n`);

  if (!apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply to execute.");
    return;
  }

  // ---------------------------------------------------------------
  // Phase 1 — merge + repoint, atomically
  // ---------------------------------------------------------------
  const statements = [
    // Free the handle first: `username` is unique, so the new row
    // can't take it while the old row still holds it.
    sql`UPDATE users SET username = NULL WHERE id = ${oldUser.id}`,

    // Merge. COALESCE(new, old) everywhere except username (old wins)
    // and created_at (earlier wins).
    sql`
      UPDATE users AS n SET
        username                   = o.username,
        created_at                 = LEAST(n.created_at, o.created_at),
        display_name               = COALESCE(n.display_name, o.display_name),
        bio                        = COALESCE(n.bio, o.bio),
        avatar_url                 = COALESCE(n.avatar_url, o.avatar_url),
        social_links               = COALESCE(n.social_links, o.social_links),
        stripe_account_id          = COALESCE(n.stripe_account_id, o.stripe_account_id),
        stripe_onboarding_complete = COALESCE(n.stripe_onboarding_complete, o.stripe_onboarding_complete),
        stripe_customer_id         = COALESCE(n.stripe_customer_id, o.stripe_customer_id),
        default_payment_method     = COALESCE(n.default_payment_method, o.default_payment_method),
        default_upload_visibility  = COALESCE(n.default_upload_visibility, o.default_upload_visibility),
        email_notifications_enabled = COALESCE(n.email_notifications_enabled, o.email_notifications_enabled),
        email_notification_prefs   = COALESCE(n.email_notification_prefs, o.email_notification_prefs)
      FROM (SELECT * FROM users WHERE id = ${oldUser.id}) AS o
      WHERE n.id = ${newUser.id}
    `,

    // Repoint every child row.
    ...refs.map((ref) =>
      sql.query(
        `UPDATE "${ref.table_name}" SET "${ref.column_name}" = $1 WHERE "${ref.column_name}" = $2`,
        [newUser.id, oldUser.id]
      )
    ),
  ];

  await sql.transaction(statements);
  console.log("Phase 1 complete: merged profile and repointed child rows.");

  // ---------------------------------------------------------------
  // Phase 2 — verify, then remove the stripped old row
  // ---------------------------------------------------------------
  const leftovers: Array<{ table: string; column: string; rows: number }> = [];
  for (const ref of refs) {
    const rows = (await sql.query(
      `SELECT COUNT(*)::int AS n FROM "${ref.table_name}" WHERE "${ref.column_name}" = $1`,
      [oldUser.id]
    )) as Array<{ n: number }>;
    if ((rows[0]?.n ?? 0) > 0) {
      leftovers.push({
        table: ref.table_name,
        column: ref.column_name,
        rows: rows[0].n,
      });
    }
  }

  if (leftovers.length > 0) {
    console.error(
      "\nSTOPPING before delete — rows still reference the old id:"
    );
    console.table(leftovers);
    console.error(
      `The merge already succeeded; the old row (${oldUser.id}) was left in place ` +
        "so its remaining children aren't cascade-deleted. Investigate, then delete it manually."
    );
    process.exit(1);
  }

  await sql`DELETE FROM users WHERE id = ${oldUser.id}`;
  console.log(
    `Phase 2 complete: old row ${oldUser.id} removed (0 remaining references).`
  );
  console.log(
    `\nDone. "${oldUser.username}" now belongs to ${newUser.id}.`
  );
}

main().catch((err) => {
  console.error("remap failed:", err);
  process.exit(1);
});
