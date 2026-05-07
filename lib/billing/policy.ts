import "server-only";

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { tokenSpendingLedger } from "@/lib/db/schema";

/**
 * Spending policy attached to a personal access token. Mirrors the
 * jsonb shape on `personalAccessTokens.spendingPolicy`.
 *
 * Null policy means "no auto-approval — every agent order requires
 * the human to click an emailed confirmation link." This is the v1
 * default and remains the safe fallback whenever any field is
 * missing or the user hasn't saved a payment method.
 */
export interface SpendingPolicy {
  /** Hard cap on a single order. Orders above this fall through. */
  perOrderLimitCents: number;
  /** Cap on cumulative auto-approved spend within `periodWindow`. */
  periodBudgetCents: number;
  /** Rolling window for the budget. */
  periodWindow: "day" | "week" | "month";
  /**
   * Soft confirmation threshold within budget. If set, orders above
   * this amount still fall through to confirm-by-email even if they
   * fit the policy. Lets users say "auto-approve up to $25, ask me
   * for anything bigger."
   */
  confirmAboveCents?: number;
  /** Optional vendor allowlist (CraftCloud vendor ids). */
  allowedVendorIds?: string[];
  /** Optional material allowlist (CraftCloud material config ids). */
  allowedMaterialIds?: string[];
  /**
   * How long to hold the order before placing it with CraftCloud,
   * giving the user a "cancel" window from the auto-approved email.
   * Defaults to 5 minutes; 0 disables the window entirely.
   */
  cancellationWindowMinutes?: number;
}

export type PolicyEvaluation =
  | {
      approved: true;
      cancellationWindowMinutes: number;
      remainingPeriodBudgetCents: number;
    }
  | { approved: false; reason: string };

const DEFAULT_CANCELLATION_WINDOW_MINUTES = 5;

interface EvaluateInput {
  policy: SpendingPolicy | null;
  tokenId: string;
  orderTotalCents: number;
  vendorId: string;
  materialId: string;
  /**
   * Whether the user has a saved off-session payment method. Even a
   * generous policy can't auto-charge an empty wallet — this short-
   * circuits the policy check so the surfaced reason is "add a card"
   * rather than something budget-shaped.
   */
  hasPaymentMethod: boolean;
  /** Injected for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Decide whether an agent-initiated order can be auto-charged. All
 * "false" outcomes mean "fall through to today's confirm-by-email
 * flow"; the `reason` is forwarded to the agent in the MCP tool
 * response so the human-readable surface (and the agent itself) can
 * explain why the cheaper path didn't apply.
 *
 * Each rejection path is mutually exclusive — first match wins, so
 * the order of checks is the order they're surfaced. We check the
 * cheap, definite ones first (no policy, no card, hard limits) and
 * only hit the DB for the period budget after everything else
 * passes.
 */
export async function evaluateSpendingPolicy(
  input: EvaluateInput
): Promise<PolicyEvaluation> {
  const {
    policy,
    tokenId,
    orderTotalCents,
    vendorId,
    materialId,
    hasPaymentMethod,
    now = new Date(),
  } = input;

  if (!policy) {
    return {
      approved: false,
      reason: "No spending policy configured for this token",
    };
  }
  if (!hasPaymentMethod) {
    return {
      approved: false,
      reason:
        "No payment method on file. Add a card in settings to enable auto-approval.",
    };
  }
  if (orderTotalCents > policy.perOrderLimitCents) {
    return {
      approved: false,
      reason: `Exceeds per-order limit (${dollars(policy.perOrderLimitCents)} cap, this order ${dollars(orderTotalCents)})`,
    };
  }
  if (
    policy.confirmAboveCents != null &&
    orderTotalCents > policy.confirmAboveCents
  ) {
    return {
      approved: false,
      reason: `Order requires confirmation (over ${dollars(policy.confirmAboveCents)} threshold)`,
    };
  }
  if (
    policy.allowedVendorIds &&
    policy.allowedVendorIds.length > 0 &&
    !policy.allowedVendorIds.includes(vendorId)
  ) {
    return {
      approved: false,
      reason: "Vendor not in this token's allowlist",
    };
  }
  if (
    policy.allowedMaterialIds &&
    policy.allowedMaterialIds.length > 0 &&
    !policy.allowedMaterialIds.includes(materialId)
  ) {
    return {
      approved: false,
      reason: "Material not in this token's allowlist",
    };
  }

  const periodStart = computePeriodStart(policy.periodWindow, now);
  const recent = await db
    .select({ amountCents: tokenSpendingLedger.amountCents })
    .from(tokenSpendingLedger)
    .where(
      and(
        eq(tokenSpendingLedger.tokenId, tokenId),
        gte(tokenSpendingLedger.chargedAt, periodStart)
      )
    );
  const spent = recent.reduce((sum, r) => sum + r.amountCents, 0);

  if (spent + orderTotalCents > policy.periodBudgetCents) {
    return {
      approved: false,
      reason: `Exceeds ${policy.periodWindow} budget (${dollars(policy.periodBudgetCents)} cap, would be ${dollars(spent + orderTotalCents)} including this order)`,
    };
  }

  return {
    approved: true,
    cancellationWindowMinutes:
      policy.cancellationWindowMinutes ?? DEFAULT_CANCELLATION_WINDOW_MINUTES,
    remainingPeriodBudgetCents:
      policy.periodBudgetCents - spent - orderTotalCents,
  };
}

/**
 * UTC start of the period containing `now`. Day = midnight UTC,
 * week = ISO Monday midnight UTC, month = first-of-month midnight
 * UTC. Periods are deliberately aligned to UTC rather than the
 * user's local timezone — agents charge from server time, and
 * "tomorrow" should mean "tomorrow on the server" so a budget reset
 * isn't ambiguous near midnight in the user's zone.
 */
export function computePeriodStart(
  window: "day" | "week" | "month",
  now: Date
): Date {
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  if (window === "day") return utcMidnight;
  if (window === "week") {
    // ISO week starts Monday. Sunday = 0 in JS, so map it to 6.
    const day = utcMidnight.getUTCDay();
    const offset = day === 0 ? 6 : day - 1;
    return new Date(utcMidnight.getTime() - offset * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
