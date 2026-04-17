/**
 * Garbage-collects R2 objects under `uploads/` that no `file_assets`
 * row points to and are older than a safety threshold.
 *
 * These orphans happen when a presigned PUT to R2 succeeds but the
 * subsequent createDraftFileForPrint / createFileListing server
 * action fails — the object lands in the bucket with no DB
 * reference, and there's no foreground cleanup path.
 *
 * Run with:
 *   bun run scripts/cleanup-orphan-uploads.ts --dry-run    # preview
 *   bun run scripts/cleanup-orphan-uploads.ts              # delete
 *
 * Safety rails:
 *   - Only touches keys with the `uploads/` prefix (not thumbnails/,
 *     not public assets, not anything outside the upload flow).
 *   - Only deletes objects LastModified > ORPHAN_MIN_AGE_HOURS ago
 *     — an in-flight upload that's still being wired to its
 *     fileAssets row won't get swept out from under it.
 *   - Dry-run mode prints the delete list without issuing any
 *     DeleteObject calls.
 *
 * Intended to run as a scheduled Vercel cron (say hourly) — wire it
 * to /api/cron/cleanup-orphans later. For now it's a manual script.
 */

import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";

// Mirror scripts/db-migrate.ts env loading for local runs.
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

const DRY_RUN = process.argv.includes("--dry-run");
const UPLOAD_PREFIX = "uploads/";
/**
 * Objects younger than this might still be mid-upload or pending
 * their createDraftFileForPrint call. Keep them — sweep only once
 * the workflow is definitively done.
 */
const ORPHAN_MIN_AGE_HOURS = 24;
/**
 * DeleteObjects can batch up to 1000 keys per call. Use a smaller
 * batch so each delete is responsive in dry-run logs and we don't
 * blow through the R2 API budget on a single invocation.
 */
const DELETE_BATCH_SIZE = 100;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — set in .env.local`);
  return v;
}

async function main() {
  const accountId = required("R2_ACCOUNT_ID");
  const accessKeyId = required("R2_ACCESS_KEY_ID");
  const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
  const bucket = required("R2_BUCKET_NAME");
  const databaseUrl = required("DATABASE_URL");

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const sql = neon(databaseUrl);

  // Pull every storage_key currently referenced by file_assets. Small
  // table, fits in memory. A single Set is the fastest lookup.
  const referencedRows = (await sql`
    SELECT storage_key FROM file_assets
  `) as { storage_key: string }[];
  const referenced = new Set(referencedRows.map((r) => r.storage_key));
  console.log(`file_assets references ${referenced.size} storage keys`);

  const now = Date.now();
  const minAgeMs = ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;

  // Paginated list — R2 caps at 1000 keys per response, so we loop
  // with ContinuationToken until the bucket is exhausted.
  let continuationToken: string | undefined;
  let scanned = 0;
  const orphans: _Object[] = [];

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: UPLOAD_PREFIX,
        ContinuationToken: continuationToken,
      })
    );
    const contents = res.Contents ?? [];
    scanned += contents.length;

    for (const obj of contents) {
      if (!obj.Key) continue;
      // Safety: never sweep outside the uploads/ prefix.
      if (!obj.Key.startsWith(UPLOAD_PREFIX)) continue;
      // Known-good — referenced by a fileAssets row.
      if (referenced.has(obj.Key)) continue;
      // Too young — may still be mid-workflow.
      if (obj.LastModified && now - obj.LastModified.getTime() < minAgeMs) {
        continue;
      }
      orphans.push(obj);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`Scanned ${scanned} objects, found ${orphans.length} orphans`);
  if (orphans.length === 0) {
    console.log("Nothing to clean.");
    return;
  }

  let totalBytes = 0;
  for (const o of orphans) totalBytes += o.Size ?? 0;
  console.log(
    `Reclaiming ${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${orphans.length} keys`
  );

  if (DRY_RUN) {
    console.log("\n--dry-run: the following keys would be deleted:");
    for (const o of orphans) {
      console.log(
        `  ${o.Key}  (${o.Size ?? 0}B, last modified ${o.LastModified?.toISOString() ?? "?"})`
      );
    }
    return;
  }

  let deleted = 0;
  for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
    const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch
            .map((o) => (o.Key ? { Key: o.Key } : null))
            .filter((k): k is { Key: string } => k !== null),
        },
      })
    );
    deleted += res.Deleted?.length ?? 0;
    if (res.Errors && res.Errors.length > 0) {
      for (const err of res.Errors) {
        console.warn(`  error deleting ${err.Key}: ${err.Message}`);
      }
    }
  }

  console.log(`\nDeleted ${deleted} orphan objects.`);
}

main().catch((err) => {
  console.error("Orphan cleanup failed:", err);
  process.exit(1);
});
