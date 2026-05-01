/**
 * Backfill geometry_hash, coarse_fingerprint, and bbox/volume/triangle
 * stats for existing file_assets rows. Also fills content_hash if it
 * was previously null (early uploads pre-dating the byte-hash work).
 *
 * Strictly additive — only touches columns that are currently NULL,
 * never overwrites a row that's already been fingerprinted. Safe to
 * run repeatedly; safe to interrupt.
 *
 * Usage:
 *   bun run scripts/backfill-mesh-fingerprint.ts            # real run
 *   bun run scripts/backfill-mesh-fingerprint.ts --dry-run  # count only
 *   bun run scripts/backfill-mesh-fingerprint.ts --limit 50 # cap rows
 *
 * Concurrency: the R2 fetch is the slow leg; we run a small worker
 * pool (default 4) so a few hundred rows backfill in a couple minutes
 * without hammering R2 or Neon.
 */

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  fingerprintFromStream,
  GEOMETRY_HASH_VERSION,
  type MeshFormat,
} from "../lib/hashing/mesh-fingerprint";

// .env.local fallback so this works the same way `npm run db:migrate`
// does locally.
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

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit"));
const limit = limitArg
  ? parseInt(limitArg.split("=")[1] ?? process.argv[process.argv.indexOf(limitArg) + 1] ?? "0", 10)
  : null;
const concurrency = 4;

type Row = {
  id: string;
  storage_key: string;
  format: string;
  file_unit: string;
  has_byte_hash: boolean;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = requireEnv("R2_BUCKET_NAME");

  const counts = (await sql`
    SELECT
      count(*) FILTER (WHERE geometry_hash IS NULL AND format IN ('stl','obj','3mf'))::int AS need_geom,
      count(*) FILTER (WHERE content_hash IS NULL)::int AS need_byte,
      count(*)::int AS total
    FROM file_assets
  `) as { need_geom: number; need_byte: number; total: number }[];
  const { need_geom, need_byte, total } = counts[0];

  console.log(`file_assets total:               ${total}`);
  console.log(`needs geometry hash (stl/obj/3mf): ${need_geom}`);
  console.log(`needs byte hash:                 ${need_byte}`);

  if (dryRun) {
    console.log("--dry-run: not mutating.");
    return;
  }
  if (need_geom === 0 && need_byte === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const safeLimit = limit && limit > 0 ? limit : null;
  const rows = (
    safeLimit !== null
      ? await sql`
          SELECT
            id::text,
            storage_key,
            format::text,
            file_unit::text,
            (content_hash IS NOT NULL) AS has_byte_hash
          FROM file_assets
          WHERE
            (geometry_hash IS NULL AND format IN ('stl','obj','3mf'))
            OR content_hash IS NULL
          ORDER BY created_at ASC
          LIMIT ${safeLimit}
        `
      : await sql`
          SELECT
            id::text,
            storage_key,
            format::text,
            file_unit::text,
            (content_hash IS NOT NULL) AS has_byte_hash
          FROM file_assets
          WHERE
            (geometry_hash IS NULL AND format IN ('stl','obj','3mf'))
            OR content_hash IS NULL
          ORDER BY created_at ASC
        `
  ) as Row[];

  console.log(`processing ${rows.length} row(s) with concurrency=${concurrency}...`);

  let ok = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= rows.length) return;
      const row = rows[i];
      try {
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: row.storage_key });
        const presigned = await getSignedUrl(s3, cmd, { expiresIn: 300 });
        const res = await fetch(presigned);
        if (!res.ok || !res.body) {
          console.warn(`  [${i}] ${row.id} fetch ${res.status}`);
          failed++;
          continue;
        }
        const fp = await fingerprintFromStream(
          res.body,
          row.format as MeshFormat,
          (row.file_unit as "mm" | "cm" | "in") ?? "mm"
        );

        // Only update columns that are still NULL, in case a parallel
        // upload happened to fingerprint the same row in the meantime.
        await sql`
          UPDATE file_assets SET
            content_hash = COALESCE(content_hash, ${fp.byteHash}),
            geometry_hash = COALESCE(geometry_hash, ${fp.geometryHash}),
            geometry_hash_version = COALESCE(
              geometry_hash_version,
              ${fp.geometryHashVersion ?? GEOMETRY_HASH_VERSION}
            ),
            coarse_fingerprint = COALESCE(coarse_fingerprint, ${fp.coarseFingerprint}),
            volume_um3 = COALESCE(volume_um3, ${fp.volumeUm3}),
            triangle_count = COALESCE(triangle_count, ${fp.triangleCount}),
            bbox_x_um = COALESCE(bbox_x_um, ${fp.bboxXUm}),
            bbox_y_um = COALESCE(bbox_y_um, ${fp.bboxYUm}),
            bbox_z_um = COALESCE(bbox_z_um, ${fp.bboxZUm})
          WHERE id = ${row.id}::uuid
        `;
        ok++;
        if (ok % 25 === 0) console.log(`  ...${ok} done`);
      } catch (err) {
        failed++;
        console.warn(`  [${i}] ${row.id} error:`, (err as Error).message);
      }
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`done. ok=${ok} failed=${failed} in ${elapsed}s`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
