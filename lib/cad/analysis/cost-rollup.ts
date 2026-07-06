import "server-only";

import { and, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, cadJobs } from "@/lib/db/schema";
import { computeCostCents, unitPricesFromEnv } from "@/lib/billing/cad-pricing";
import type { CadUsageSummary } from "@/lib/cad/types";
import { fingerprintKey } from "./implicit-signals";

/**
 * Cost rollup for the metering substrate (MTR-181) — the visibility half:
 * what does a generation actually cost, per route and per config
 * fingerprint? Mirrors the outcomes-rollup loader shape (MTR-185) so it can
 * back a scorecard "costs" section or run from
 * scripts/cad-cost-report.ts.
 *
 * Costs are RECOMPUTED from the raw cadJobs.usage at the CAD_PRICE_* unit
 * prices in force at read time — the persisted cost_cents snapshot is also
 * surfaced (as `snapshotCostCents`) so price drift is visible. With all
 * prices at their 0 defaults, the token/wall-time aggregates are the useful
 * signal.
 *
 * The pure aggregation (`rollupJobCosts`) is exported separately for tests
 * and offline use.
 */

export interface CostBucket {
  key: string;
  jobs: number;
  /** Recomputed at read-time prices (computeCostCents over raw usage). */
  costCents: number;
  /** Sum of the persisted at-termination snapshots. */
  snapshotCostCents: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  modelMs: number;
  sidecarMs: number;
  falCalls: number;
}

export interface CostRollup {
  generatedAt: string;
  jobs: number;
  /** Jobs that predate metering (no usage recorded) — excluded from buckets. */
  unmeteredJobs: number;
  totalCostCents: number;
  byRoute: CostBucket[];
  byFingerprint: CostBucket[];
}

export interface CostJobInput {
  usage: CadUsageSummary | null;
  costCents: number | null;
  /** The generation's configFingerprint (jsonb), for fingerprint slicing. */
  fingerprint: unknown;
}

function emptyBucket(key: string): CostBucket {
  return {
    key,
    jobs: 0,
    costCents: 0,
    snapshotCostCents: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    modelMs: 0,
    sidecarMs: 0,
    falCalls: 0,
  };
}

/** Pure aggregation: fold metered jobs into buckets keyed by `keyOf`. */
export function rollupJobCosts(
  jobs: CostJobInput[],
  keyOf: (job: CostJobInput) => string,
  prices = unitPricesFromEnv()
): CostBucket[] {
  const buckets = new Map<string, CostBucket>();
  for (const job of jobs) {
    if (!job.usage) continue;
    const key = keyOf(job);
    const b = buckets.get(key) ?? emptyBucket(key);
    b.jobs += 1;
    b.costCents += computeCostCents(job.usage, prices);
    b.snapshotCostCents += job.costCents ?? 0;
    for (const m of job.usage.model ?? []) {
      b.inputTokens += m.inputTokens || 0;
      b.outputTokens += m.outputTokens || 0;
      b.modelCalls += m.calls || 0;
      b.modelMs += m.ms || 0;
    }
    b.sidecarMs += job.usage.sidecar?.ms || 0;
    for (const f of job.usage.fal ?? []) b.falCalls += f.calls || 0;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => b.jobs - a.jobs);
}

export interface CostRollupOptions {
  userId: string;
  sinceDays?: number;
  limit?: number;
}

/**
 * DB loader: terminal cad_jobs (with their generation's fingerprint) for one
 * user, bounded by created_at + row limit like loadOutcomesRollup — never a
 * full scan on page load.
 */
export async function loadCostRollup(
  opts: CostRollupOptions
): Promise<CostRollup> {
  const sinceDays = opts.sinceDays ?? 180;
  const limit = opts.limit ?? 10000;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      usage: cadJobs.usage,
      costCents: cadJobs.costCents,
      fingerprint: cadGenerations.configFingerprint,
    })
    .from(cadJobs)
    .innerJoin(cadGenerations, eq(cadJobs.generationId, cadGenerations.id))
    .where(
      and(
        eq(cadGenerations.userId, opts.userId),
        gte(cadJobs.createdAt, since)
      )
    )
    .limit(limit);

  const jobs: CostJobInput[] = rows.map((r) => ({
    usage: r.usage ?? null,
    costCents: r.costCents ?? null,
    fingerprint: r.fingerprint ?? null,
  }));

  const prices = unitPricesFromEnv();
  const metered = jobs.filter((j) => j.usage);
  const byRoute = rollupJobCosts(
    jobs,
    (j) => j.usage?.route ?? "unknown",
    prices
  );
  const byFingerprint = rollupJobCosts(
    jobs,
    (j) => (j.fingerprint ? fingerprintKey(j.fingerprint) : "unknown"),
    prices
  );

  return {
    generatedAt: new Date().toISOString(),
    jobs: jobs.length,
    unmeteredJobs: jobs.length - metered.length,
    totalCostCents: byRoute.reduce((sum, b) => sum + b.costCents, 0),
    byRoute,
    byFingerprint,
  };
}
