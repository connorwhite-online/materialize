import "server-only";

import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadThreads, cadGenerations, printOrders } from "@/lib/db/schema";
import {
  rollupByRouteAndFingerprint,
  type GenInput,
  type OutcomeMetrics,
  type ThreadInput,
} from "./implicit-signals";

/**
 * DB loader for the implicit-signal rollup (MTR-185). Reads cad_threads +
 * cad_generations + a print-order join (the existing print-through pattern in
 * app/(app)/prometheus/eval/page.tsx), then delegates to the pure aggregator.
 *
 * Bounded by created_at + a row limit and scoped to one user (the studio is
 * owner-only) so it never full-scans on page load; it can back a scorecard
 * "outcomes" section or run as a nightly script.
 */

export interface OutcomesRollup {
  generatedAt: string;
  threads: number;
  generations: number;
  byRoute: Array<{ key: string } & OutcomeMetrics>;
  byFingerprint: Array<{ key: string } & OutcomeMetrics>;
}

export interface RollupOptions {
  userId: string;
  sinceDays?: number;
  limit?: number;
}

export async function loadOutcomesRollup(
  opts: RollupOptions
): Promise<OutcomesRollup> {
  const sinceDays = opts.sinceDays ?? 180;
  const limit = opts.limit ?? 10000;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const threadRows = await db
    .select({ id: cadThreads.id, savedFileId: cadThreads.savedFileId })
    .from(cadThreads)
    .where(
      and(
        eq(cadThreads.userId, opts.userId),
        gte(cadThreads.createdAt, since)
      )
    )
    .limit(limit);

  const genRows = await db
    .select({
      id: cadGenerations.id,
      threadId: cadGenerations.threadId,
      status: cadGenerations.status,
      parentGenerationId: cadGenerations.parentGenerationId,
      fileAssetId: cadGenerations.fileAssetId,
      aestheticScore: cadGenerations.aestheticScore,
      remeshed: cadGenerations.remeshed,
      configFingerprint: cadGenerations.configFingerprint,
    })
    .from(cadGenerations)
    .where(
      and(
        eq(cadGenerations.userId, opts.userId),
        gte(cadGenerations.createdAt, since)
      )
    )
    .limit(limit);

  // Print-through: which of these generations' assets became print orders.
  const assetIds = genRows
    .map((g) => g.fileAssetId)
    .filter((id): id is string => !!id);
  const printedAssetIds = new Set<string>();
  if (assetIds.length > 0) {
    const orders = await db
      .select({ fileAssetId: printOrders.fileAssetId })
      .from(printOrders)
      .where(
        and(
          eq(printOrders.userId, opts.userId),
          inArray(printOrders.fileAssetId, assetIds)
        )
      );
    for (const o of orders) if (o.fileAssetId) printedAssetIds.add(o.fileAssetId);
  }

  const threads: ThreadInput[] = threadRows;
  const gens: GenInput[] = genRows.map((g) => {
    const fp = g.configFingerprint as { route?: string } | null;
    return {
      id: g.id,
      threadId: g.threadId,
      status: g.status,
      parentGenerationId: g.parentGenerationId,
      fileAssetId: g.fileAssetId,
      aestheticScore: g.aestheticScore,
      remeshed: g.remeshed,
      route: fp?.route ?? null,
      fingerprint: g.configFingerprint,
    };
  });

  const { byRoute, byFingerprint } = rollupByRouteAndFingerprint(
    threads,
    gens,
    printedAssetIds
  );

  const toRows = (m: Map<string, OutcomeMetrics>) =>
    [...m.entries()]
      .map(([key, metrics]) => ({ key, ...metrics }))
      .sort((a, b) => b.threads - a.threads);

  return {
    generatedAt: new Date().toISOString(),
    threads: threadRows.length,
    generations: genRows.length,
    byRoute: toRows(byRoute),
    byFingerprint: toRows(byFingerprint),
  };
}
