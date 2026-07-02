import "server-only";

import { and, eq, inArray, isNull, not } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, cadThreads, fileAssets, files } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

/**
 * Studio-draft lifecycle helpers (docs/text-to-cad/05 §B).
 *
 * Text-to-CAD generations mint real files/file_assets rows immediately
 * (so they're printable), but with files.source='studio'. Until the user
 * promotes one — explicit "Save to profile" or a print order — those rows
 * are working drafts that must stay invisible on every LIBRARY surface
 * (dashboard/profile file lists, org profiles, MCP file listing).
 *
 * They must stay fully reachable everywhere else: /print/[fileAssetId],
 * file-by-id/slug loads, downloads, order flows — a draft is printable by
 * its owner throughout.
 */

/**
 * Library-surface WHERE condition: exclude unsaved studio drafts
 * (source='studio' AND status='draft'). Backed by files_source_status_idx.
 * Apply this to queries that LIST a user's files; never to by-id/by-slug
 * loads or print/order flows.
 */
export function notUnsavedStudioDraft() {
  // Both operands are non-empty, so and() can't return undefined.
  return not(and(eq(files.source, "studio"), eq(files.status, "draft"))!);
}

/**
 * Implicit promotion on print (docs/text-to-cad/05 §B: "an order is a
 * save"): any unsaved studio draft among the ordered assets graduates to
 * status='published' (visibility unchanged — it stays private unless the
 * user opted otherwise; `source` stays 'studio' because it is provenance,
 * not a visibility stage). If the draft's thread has no saved file yet,
 * the promoted file becomes THE file for the design so a later explicit
 * Save re-points it instead of publishing a second entry (05 §C).
 *
 * Best-effort by design: called from inside order-creation actions after
 * the order row exists — a bookkeeping failure here must never fail the
 * order, so every error is logged and swallowed.
 */
export async function promoteStudioDraftsForAssets(params: {
  userId: string;
  fileAssetIds: (string | null | undefined)[];
}): Promise<void> {
  const assetIds = [
    ...new Set(params.fileAssetIds.filter((id): id is string => !!id)),
  ];
  if (assetIds.length === 0) return;

  try {
    const assetRows = await db
      .select({ id: fileAssets.id, fileId: fileAssets.fileId })
      .from(fileAssets)
      .where(inArray(fileAssets.id, assetIds));
    const fileIds = [
      ...new Set(
        assetRows.map((r) => r.fileId).filter((id): id is string => !!id)
      ),
    ];
    if (fileIds.length === 0) return;

    const promoted = await db
      .update(files)
      .set({ status: "published", updatedAt: new Date() })
      .where(
        and(
          inArray(files.id, fileIds),
          eq(files.userId, params.userId),
          eq(files.source, "studio"),
          eq(files.status, "draft")
        )
      )
      .returning({ id: files.id });
    if (promoted.length === 0) return;

    // Adopt each promoted file as its thread's saved file when the thread
    // has none yet (one file per design, 05 §C). Never overwrites an
    // existing savedFileId.
    const promotedFileIds = new Set(promoted.map((p) => p.id));
    const fileIdByAssetId = new Map(
      assetRows
        .filter((r) => r.fileId && promotedFileIds.has(r.fileId))
        .map((r) => [r.id, r.fileId as string])
    );
    if (fileIdByAssetId.size === 0) return;

    const gens = await db
      .select({
        fileAssetId: cadGenerations.fileAssetId,
        threadId: cadGenerations.threadId,
      })
      .from(cadGenerations)
      .where(
        and(
          inArray(cadGenerations.fileAssetId, [...fileIdByAssetId.keys()]),
          eq(cadGenerations.userId, params.userId)
        )
      );

    const savedFileByThread = new Map<string, string>();
    for (const g of gens) {
      if (!g.threadId || !g.fileAssetId) continue;
      const fileId = fileIdByAssetId.get(g.fileAssetId);
      if (fileId && !savedFileByThread.has(g.threadId)) {
        savedFileByThread.set(g.threadId, fileId);
      }
    }

    for (const [threadId, fileId] of savedFileByThread) {
      await db
        .update(cadThreads)
        .set({ savedFileId: fileId, updatedAt: new Date() })
        .where(
          and(
            eq(cadThreads.id, threadId),
            eq(cadThreads.userId, params.userId),
            isNull(cadThreads.savedFileId)
          )
        );
    }
  } catch (err) {
    logError("promoteStudioDraftsForAssets", err);
  }
}
