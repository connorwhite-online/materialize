import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cadCreditLedger,
  cadGenerations,
  printOrders,
} from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { PRINTED_STATUSES } from "@/lib/print-statuses";

/**
 * Studio credit ledger (MTR-181, docs/text-to-cad/08-monetization.md).
 *
 * Credits are the doc's recommended ABSTRACT unit (the token+CPU+fal cost
 * mix is too heterogeneous to price transparently per unit): plans/grants
 * add credits, finished generations debit them by complexity tier, and a
 * design that reaches a paid print order earns credits back — pricing the
 * studio as a funnel into the 3% print fee.
 *
 * Everything here is gated by CAD_CREDITS_ENABLED (default OFF): with the
 * flag off every writer AND reader below no-ops, so shipping this module is
 * a zero-behavior change. Credit amounts are env-tunable and default to 0,
 * so even flag-on writes nothing until the owner sets prices:
 *
 *   CAD_CREDITS_ENABLED                master switch (default off)
 *   CAD_CREDIT_COST_SIMPLE             credits per simple-route generation
 *   CAD_CREDIT_COST_COMPLEX            credits per agentic-route generation
 *   CAD_CREDIT_COST_ORGANIC            credits per generative-route generation
 *   CAD_PRINT_THROUGH_REFUND_CREDITS   credits granted back per paid print
 *                                      order of a studio design (the cap
 *                                      "N credits/order" from the doc)
 *
 * Invariants:
 *   - Balance is SUM(delta); no denormalized balance column to drift.
 *   - Idempotency lives in the DB, not in callers: partial unique indexes
 *     allow one `generation` debit per job and one `print_through_refund`
 *     per print order; writers insert with onConflictDoNothing.
 *   - NO enforcement here: this ledger records, it does not block
 *     generations on insufficient balance. The enforcement gate (and any
 *     purchase path) is a later, owner-priced issue.
 *   - Best-effort at every call site: a ledger failure must never fail a
 *     generation or a webhook — log and continue.
 */

export type CadCreditReason =
  | "generation"
  | "grant"
  | "print_through_refund"
  | "admin";

/** Master switch — default OFF; nothing below writes or reads without it. */
export function cadCreditsEnabled(): boolean {
  return process.env.CAD_CREDITS_ENABLED === "true";
}

function creditEnv(name: string): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Credits a finished generation costs, by router verdict (HarnessResult
 * .route). Route strings map onto the doc-03 complexity tiers:
 * organic → generative backend, complex* → agentic session loop, everything
 * else (simple, legacy, best-of variants, unknown) → the scripted loop.
 * All tiers default to 0 credits until the owner prices them.
 */
export function creditCostForRoute(route: string | null | undefined): number {
  const r = route ?? "";
  // "legacy-generative" (CAD-11) is the non-agentic path's generative
  // backend — same priced engine as "organic", just taken when the agentic
  // kill switch is off. Without this case it fell through to the SIMPLE
  // tier and undercharged the priciest backend.
  if (r === "organic" || r === "legacy-generative")
    return creditEnv("CAD_CREDIT_COST_ORGANIC");
  if (r.startsWith("complex")) return creditEnv("CAD_CREDIT_COST_COMPLEX");
  return creditEnv("CAD_CREDIT_COST_SIMPLE");
}

/** Credits granted back per paid print order of a studio design. */
export function printThroughRefundCredits(): number {
  return creditEnv("CAD_PRINT_THROUGH_REFUND_CREDITS");
}

/** A user's current balance: SUM(delta), 0 with no rows (or flag off). */
export async function getCadCreditBalance(userId: string): Promise<number> {
  if (!cadCreditsEnabled()) return 0;
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${cadCreditLedger.delta}), 0)::int`,
    })
    .from(cadCreditLedger)
    .where(eq(cadCreditLedger.userId, userId));
  return row?.balance ?? 0;
}

/**
 * Debit a user for a finished generation job. Called from executeCadJob on
 * success (failures/cancellations are deliberately NOT charged — real cost
 * was incurred, but charging for a failure is hostile product; the raw cost
 * still lands in cadJobs.usage either way).
 *
 * No-ops when the flag is off or the route's credit price is 0. Idempotent
 * per job via the partial unique index. Never throws.
 */
export async function recordGenerationDebit(opts: {
  userId: string;
  jobId: string;
  generationId: string;
  route?: string | null;
}): Promise<void> {
  if (!cadCreditsEnabled()) return;
  const cost = creditCostForRoute(opts.route);
  if (cost <= 0) return;
  try {
    await db
      .insert(cadCreditLedger)
      .values({
        userId: opts.userId,
        delta: -cost,
        reason: "generation",
        jobId: opts.jobId,
        generationId: opts.generationId,
        note: opts.route ? `route:${opts.route}` : null,
      })
      .onConflictDoNothing();
  } catch (err) {
    // Ledger bookkeeping must never fail a generation.
    logError("cadCredits.recordGenerationDebit", err);
  }
}

/** Grant credits (signup/monthly/plan/admin). Flag-gated; never throws. */
export async function grantCadCredits(opts: {
  userId: string;
  amount: number;
  reason: Extract<CadCreditReason, "grant" | "admin">;
  note?: string;
}): Promise<void> {
  if (!cadCreditsEnabled()) return;
  if (!Number.isFinite(opts.amount) || opts.amount === 0) return;
  try {
    await db.insert(cadCreditLedger).values({
      userId: opts.userId,
      delta: Math.trunc(opts.amount),
      reason: opts.reason,
      note: opts.note ?? null,
    });
  } catch (err) {
    logError("cadCredits.grantCadCredits", err);
  }
}

/**
 * Print-through refund (docs/text-to-cad/08 "strategic alignment"): when a
 * studio-generated design reaches a PAID print order, credit the user back
 * CAD_PRINT_THROUGH_REFUND_CREDITS. Mechanics (recorded decision, MTR-181):
 * a FLAT capped grant per qualifying print order — the doc's "full refund
 * capped at N credits/order" with N as the env knob — attributed to the
 * order's most recent succeeded generation. Flat beats summing historical
 * debits: simpler, identical once per-generation cost ≤ the cap, and it
 * can't leak more than N per order.
 *
 * Qualifying = the order's fileAssetId belongs to a succeeded cadGeneration
 * of the SAME user, and the order status is in PRINTED_STATUSES (financially
 * committed — mirrors lib/print-statuses.ts).
 *
 * Idempotent per print order via the partial unique index, so it is safe
 * from a webhook, a cron, AND the backfill script simultaneously. Never
 * throws; returns the credits granted (0 = no-op/duplicate/not qualifying).
 *
 * Wiring: called today from scripts/grant-cad-print-through-credits.ts
 * (backfill / cron-able). Hooking it into the Stripe webhook's
 * handlePrintOrderPayment is a follow-up — deliberately NOT done in this
 * wave to keep the payment webhook untouched (AGENTS.md print-pipeline
 * rails).
 */
export async function grantPrintThroughRefund(opts: {
  printOrderId: string;
}): Promise<number> {
  if (!cadCreditsEnabled()) return 0;
  const credits = printThroughRefundCredits();
  if (credits <= 0) return 0;

  try {
    const [order] = await db
      .select({
        id: printOrders.id,
        userId: printOrders.userId,
        fileAssetId: printOrders.fileAssetId,
        status: printOrders.status,
      })
      .from(printOrders)
      .where(eq(printOrders.id, opts.printOrderId))
      .limit(1);
    if (!order?.fileAssetId) return 0;
    if (!(PRINTED_STATUSES as readonly string[]).includes(order.status)) {
      return 0;
    }

    // The design must be a studio generation owned by the SAME user — the
    // funnel refund is for "generate here → print here", not for printing
    // someone else's generated listing.
    const gens = await db
      .select({ id: cadGenerations.id })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.fileAssetId, order.fileAssetId),
          eq(cadGenerations.userId, order.userId),
          eq(cadGenerations.status, "succeeded")
        )
      )
      .orderBy(sql`${cadGenerations.createdAt} desc`)
      .limit(1);
    const generation = gens[0];
    if (!generation) return 0;

    const inserted = await db
      .insert(cadCreditLedger)
      .values({
        userId: order.userId,
        delta: credits,
        reason: "print_through_refund",
        generationId: generation.id,
        printOrderId: order.id,
      })
      .onConflictDoNothing()
      .returning({ id: cadCreditLedger.id });
    return inserted.length > 0 ? credits : 0;
  } catch (err) {
    logError("cadCredits.grantPrintThroughRefund", err);
    return 0;
  }
}

/**
 * Backfill sweep: find print orders in PRINTED_STATUSES whose asset came
 * from a studio generation and grant any missing print-through refunds.
 * Bounded + idempotent (the unique index dedupes), so it can run repeatedly
 * — scripts/grant-cad-print-through-credits.ts is the entry point and a
 * cron can adopt it later. Returns per-order grants for reporting.
 */
export async function sweepPrintThroughRefunds(opts?: {
  limit?: number;
}): Promise<Array<{ printOrderId: string; credits: number }>> {
  if (!cadCreditsEnabled()) return [];
  if (printThroughRefundCredits() <= 0) return [];
  const limit = opts?.limit ?? 500;

  // Candidate orders: paid statuses with an asset that ANY succeeded
  // generation points at (per-order ownership recheck happens inside
  // grantPrintThroughRefund).
  const candidates = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .innerJoin(
      cadGenerations,
      and(
        eq(cadGenerations.fileAssetId, printOrders.fileAssetId),
        eq(cadGenerations.userId, printOrders.userId),
        eq(cadGenerations.status, "succeeded")
      )
    )
    .where(inArray(printOrders.status, [...PRINTED_STATUSES]))
    .limit(limit);

  const results: Array<{ printOrderId: string; credits: number }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const credits = await grantPrintThroughRefund({ printOrderId: c.id });
    if (credits > 0) results.push({ printOrderId: c.id, credits });
  }
  return results;
}
