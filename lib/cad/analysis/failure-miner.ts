import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { repairHintFor } from "@/lib/cad/harness";
import { completeText, hasModelCredentials } from "@/lib/cad/model-client";
import {
  clusterFailures,
  computeRepairEfficacy,
  normalizeErrorSignature,
  type FailureCluster,
  type GenerationOutcome,
  type SignatureEfficacy,
} from "./failure-signature";

/**
 * Failure miner (MTR-186): cluster recurring generation errors into candidate
 * repair hints, HUMAN-GATED. Reads only already-persisted `cadGenerations`
 * error/sourceCode data — it does NOT touch the harness hot path, and nothing
 * here is auto-injected into `repairHintFor`. A human reviews the review
 * queue and lands approved hints by hand.
 *
 * Deliberately additive/offline: run via `scripts/cad-failure-miner.ts` on a
 * schedule or on demand. `repairHintFor` is imported read-only to decide
 * which clusters are ALREADY covered (so we only surface novel classes).
 */

const CODE_EXCERPT_CHARS = 2000;

export interface MinedCandidate {
  signature: string;
  representative: string;
  count: number;
  /** True when repairHintFor already returns guidance for this class. */
  covered: boolean;
  /** Repair success rate for this signature, when it has follow-up attempts. */
  efficacy: SignatureEfficacy | null;
  examples: Array<{ id: string; error: string; codeExcerpt: string | null }>;
  /** Model-drafted candidate hint (only for uncovered candidates), or null. */
  draftedHint: string | null;
}

export interface FailureMinerReport {
  generatedAt: string;
  scannedRows: number;
  totalFailures: number;
  clusterCount: number;
  /** Uncovered clusters at/above the threshold — the human review queue. */
  candidates: MinedCandidate[];
  /** Already-covered clusters with their efficacy — the rotate-out signal. */
  covered: Array<{
    signature: string;
    representative: string;
    count: number;
    efficacy: SignatureEfficacy | null;
  }>;
}

export interface MineOptions {
  /** Scope to one user's rows; omit for all users. */
  userId?: string;
  /** Only rows created within this many days (default 90). */
  sinceDays?: number;
  /** Max rows scanned (default 5000). */
  limit?: number;
  /** Min cluster size to be a review candidate (default 3). */
  minClusterCount?: number;
  /** Draft hints via one model call per top candidate (default false). */
  draftHints?: boolean;
  /** Cap model calls when drafting (default 5). */
  maxDrafts?: number;
}

function excerpt(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.length > CODE_EXCERPT_CHARS
    ? code.slice(0, CODE_EXCERPT_CHARS) + "\n… (truncated)"
    : code;
}

export async function mineFailures(
  opts: MineOptions = {}
): Promise<FailureMinerReport> {
  const sinceDays = opts.sinceDays ?? 90;
  const limit = opts.limit ?? 5000;
  const minClusterCount = opts.minClusterCount ?? 3;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: cadGenerations.id,
      parentGenerationId: cadGenerations.parentGenerationId,
      status: cadGenerations.status,
      error: cadGenerations.error,
      sourceCode: cadGenerations.sourceCode,
      createdAt: cadGenerations.createdAt,
    })
    .from(cadGenerations)
    // Load failed AND non-failed rows in the window: non-failed rows are
    // needed to compute repair efficacy (did a failure's child succeed?).
    // Bounded by created_at + limit; rides cad_generations_user_created_idx.
    .where(
      and(
        gte(cadGenerations.createdAt, since),
        opts.userId ? eq(cadGenerations.userId, opts.userId) : undefined
      )
    )
    .orderBy(desc(cadGenerations.createdAt))
    .limit(limit);

  const outcomes: GenerationOutcome[] = rows.map((r) => ({
    id: r.id,
    parentGenerationId: r.parentGenerationId,
    status: r.status,
    error: r.error,
  }));

  const failures = rows
    .filter((r) => r.status === "failed" && r.error)
    .map((r) => ({
      id: r.id,
      error: r.error as string,
      sourceCode: r.sourceCode,
      createdAt: r.createdAt,
    }));

  const clusters = clusterFailures(failures, { minCount: 1, maxExamples: 3 });
  const efficacy = computeRepairEfficacy(outcomes);
  const efficacyBySig = new Map(efficacy.map((e) => [e.signature, e]));

  const covered: FailureMinerReport["covered"] = [];
  const candidateClusters: FailureCluster[] = [];
  for (const c of clusters) {
    const isCovered = repairHintFor(c.representative).trim() !== "";
    if (isCovered) {
      covered.push({
        signature: c.signature,
        representative: c.representative,
        count: c.count,
        efficacy: efficacyBySig.get(c.signature) ?? null,
      });
    } else if (c.count >= minClusterCount) {
      candidateClusters.push(c);
    }
  }

  const candidates: MinedCandidate[] = candidateClusters.map((c) => ({
    signature: c.signature,
    representative: c.representative,
    count: c.count,
    covered: false,
    efficacy: efficacyBySig.get(c.signature) ?? null,
    examples: c.examples.map((e) => ({
      id: e.id,
      error: e.error,
      codeExcerpt: excerpt(e.sourceCode),
    })),
    draftedHint: null,
  }));

  if (opts.draftHints && hasModelCredentials()) {
    const maxDrafts = opts.maxDrafts ?? 5;
    for (const candidate of candidates.slice(0, maxDrafts)) {
      candidate.draftedHint = await draftRepairHint(candidate).catch(
        () => null
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scannedRows: rows.length,
    totalFailures: failures.length,
    clusterCount: clusters.length,
    candidates,
    covered: covered.sort((a, b) => b.count - a.count),
  };
}

const DRAFT_SYSTEM = `You maintain repairHintFor(), a function that maps a CAD-code generation failure to ONE short, imperative repair instruction the model reads before its next attempt. A good hint names the specific mistake and the concrete fix (what to change, to what), never a generic "try again". Given a recurring failure class (a few example errors + the code that produced them), write ONE candidate hint of 1–3 sentences. If the class is too generic or not actionable, reply with exactly "NONE".`;

/** One model call drafting a candidate hint from a cluster's examples. */
async function draftRepairHint(candidate: MinedCandidate): Promise<string | null> {
  const examples = candidate.examples
    .slice(0, 3)
    .map(
      (e, i) =>
        `Example ${i + 1}\nerror: ${e.error}\ncode:\n${
          e.codeExcerpt ?? "(no code captured)"
        }`
    )
    .join("\n\n");
  const prompt = `Failure class (signature): ${candidate.signature}\nOccurrences: ${candidate.count}\n\n${examples}\n\nWrite the candidate hint, or "NONE".`;
  const text = (await completeText({ system: DRAFT_SYSTEM, prompt })).trim();
  if (!text || text.toUpperCase() === "NONE") return null;
  return text;
}

/** Re-export so the script can key on the same normalizer. */
export { normalizeErrorSignature };
