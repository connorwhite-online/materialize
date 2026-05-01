import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { logError } from "@/lib/logger";
import { fingerprintAndPersistAsset } from "@/lib/hashing/fingerprint-asset";
import type { MeshFormat } from "@/lib/hashing/mesh-fingerprint";

/**
 * Safety net for the deferred fingerprint pass scheduled in
 * app/actions/files.ts via Next 16 `after()`. On Vercel the deferred
 * task runs in the same function instance and is killable when the
 * function shuts down — a long-tail of uploads land with their
 * geometry hash never written. This sweep picks them up.
 *
 * Selects parseable rows older than 1h with `geometry_hash IS NULL`,
 * runs the same fingerprint + cross-user collision pass that the inline
 * `after()` would have, and updates the row (which can also trigger an
 * auto-archive flag). The 1h floor avoids racing the inline task.
 *
 * Bounded per-run: at most STRAGGLER_LIMIT rows per invocation, with
 * fixed concurrency so we don't slam R2 or the function's wall-clock
 * budget. Hourly cadence + 25/run = ~600 stragglers/day of headroom,
 * far above any realistic miss rate.
 *
 * Auth: Vercel cron triggers include `Authorization: Bearer
 * ${CRON_SECRET}`. Without that header (or with a wrong value) we 401.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/sweep-fingerprint-stragglers
 */

const STRAGGLER_AGE_MS = 60 * 60 * 1000;
const STRAGGLER_LIMIT = 25;
const CONCURRENCY = 4;

// Vercel function wall-clock cap. 25 rows * 3s / 4 workers ≈ 20s, well
// under this; the budget is here so a single pathological row that
// stalls on an R2 fetch can't drag the whole sweep past the timeout.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - STRAGGLER_AGE_MS);

    const rows = await db
      .select({
        assetId: fileAssets.id,
        fileId: fileAssets.fileId,
        ownerUserId: files.userId,
        storageKey: fileAssets.storageKey,
        format: fileAssets.format,
        fileUnit: fileAssets.fileUnit,
      })
      .from(fileAssets)
      .innerJoin(files, eq(fileAssets.fileId, files.id))
      .where(
        and(
          isNull(fileAssets.geometryHash),
          inArray(fileAssets.format, ["stl", "obj", "3mf"]),
          lt(fileAssets.createdAt, cutoff)
        )
      )
      .limit(STRAGGLER_LIMIT);

    if (rows.length === 0) {
      return Response.json({
        scanned: 0,
        succeeded: 0,
        failed: 0,
        cutoff: cutoff.toISOString(),
      });
    }

    let idx = 0;
    let succeeded = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= rows.length) return;
        const row = rows[i];
        if (!row.fileId) continue; // schema allows null but the join filters it; defensive
        try {
          await fingerprintAndPersistAsset({
            assetId: row.assetId,
            fileId: row.fileId,
            ownerUserId: row.ownerUserId,
            storageKey: row.storageKey,
            format: row.format as MeshFormat,
            fileUnit: row.fileUnit,
          });
          succeeded++;
        } catch (err) {
          // fingerprintAndPersistAsset never throws today, but guard so
          // a future change can't tank the sweep.
          logError("cron/sweep-fingerprint-stragglers.row", {
            assetId: row.assetId,
            error: err,
          });
          failed++;
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker())
    );

    const result = {
      scanned: rows.length,
      succeeded,
      failed,
      cutoff: cutoff.toISOString(),
    };
    console.log("[cron/sweep-fingerprint-stragglers] swept", result);
    return Response.json(result);
  } catch (error) {
    logError("cron/sweep-fingerprint-stragglers", error);
    return Response.json({ error: "Sweep failed" }, { status: 500 });
  }
}
