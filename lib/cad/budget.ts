import { AsyncLocalStorage } from "node:async_hooks";

import { activeCadContext } from "./metering";

/**
 * What one generation is allowed to spend (MTR-181 follow-up).
 *
 * The harness had exactly one notion of complexity — `classifyCadRequest`'s
 * one-word verdict — and it chose only the ENGINE. Everything downstream then
 * spent a fixed budget regardless of the part: `implement`/`repair` ran at
 * `xhigh` on a 4-hole plate and on a heat exchanger alike, the agentic loop
 * was allowed 600s and 16 tool turns either way, and the scripted loop always
 * offered 4 repair attempts. Nothing anywhere read "how big is this job" after
 * the router had spoken, and nothing at all read "how much has this job
 * already spent" — so a misrouted simple part could burn the whole platform
 * window and a five-dollar token bill before being platform-killed with
 * nothing persisted (the 2026-09-11 "generation interrupted" post-mortem).
 *
 * This module is the missing half of the router: the verdict now sets the
 * BUDGET as well as the engine.
 *
 * Two independent mechanisms, deliberately not the same thing:
 *
 *  1. **Tier** — proportionality. The router's class selects a `CadTierBudget`
 *     that shapes effort, turns and attempts. This is the part that makes a
 *     simple part cheap: it lowers the ceiling on work that was never sized to
 *     the part in the first place.
 *  2. **Token ceiling** — a runaway backstop, NOT the shaping mechanism. It
 *     exists so that a loop which misbehaves (a repair cycle that never
 *     converges, a turn budget that keeps finding more to do) stops costing
 *     money at a known bound instead of at the platform's kill signal. Tuned
 *     to sit well above a healthy run of its tier: if the ceiling is what
 *     stops your build, something upstream is wrong.
 *
 * Propagation is AsyncLocalStorage, matching ./metering's reasoning exactly —
 * the alternative is threading a tier parameter through every role call site
 * in harness/agentic/critique/brief/title. The orchestrator wraps each engine
 * call in `runWithCadTier`, and `effortForRole` (./models) reads whatever tier
 * is active. Outside a tiered run — the eval runner, scripts, tests, and the
 * legacy no-agentic path whose byte-identical behavior ./orchestrate promises
 * — there is no active tier and every default below is simply not applied.
 *
 * Pure (no `server-only`) over node:async_hooks, like ./metering, so the eval
 * runner and tests can drive it directly.
 */

/** The effort ladder, shared by both vendors (see ./models). */
export type CadEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORTS: readonly CadEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Budget tiers are the router's own vocabulary (`CadRequestClass`), 1:1 and
 * deliberately: a fourth tier that the classifier cannot produce would be a
 * second, invisible routing decision.
 */
export type CadTier = "simple" | "complex" | "organic";

export interface CadTierBudget {
  /**
   * Upper bound on per-role effort. Applied as a CLAMP, never a set: a role
   * whose default is already cheaper keeps it (`title` stays `low`), and a
   * role whose default is dearer comes down to this. Raising a role above its
   * table default is not something a complexity heuristic should be able to
   * do.
   */
  effortCap: CadEffort;
  /** Wall-clock budget for the agentic loop (ms), before deadline trimming. */
  agenticMaxMs: number;
  /** Agentic tool-turn cap — each turn is one model call plus its execs. */
  maxToolTurns: number;
  /** Scripted repair attempts, including the first generation. */
  maxAttempts: number;
  /**
   * Runaway backstop: model tokens (input + output, summed across every role)
   * this generation may spend before the loops stop starting new work.
   *
   * Cache reads and writes are deliberately EXCLUDED. They are the cheap path
   * — counting them would make a well-cached run, which is the behavior
   * MTR-221/222 exists to produce, trip the ceiling sooner than an uncached
   * one burning the same money.
   */
  maxTokens: number;
}

/**
 * Per-tier budgets.
 *
 * `complex` is today's behavior, unchanged and on purpose: it is the tier the
 * existing constants were actually chosen for (agentic.ts's 600s is sized to a
 * "full-scale TPMS/exchanger build", harness.ts's 4 attempts to "complex parts
 * [clearing] a sequence of distinct build123d gotchas"). Those rationales are
 * quoted here because they are also the argument for the other tiers being
 * smaller — each was written about a complex part and then applied to every
 * part.
 *
 * `simple` is the tier that pays for this change:
 *   - effort — `implement`/`repair` default to `xhigh` for multi-constraint
 *     spatial reasoning. A plate with four holes has no multi-constraint
 *     spatial reasoning to do, and reasoning bills as output tokens.
 *   - attempts — a simple part that fails twice is usually an underspecified
 *     prompt, not a chain of distinct gotchas; a 3rd and 4th attempt on it
 *     mostly re-buys the same failure.
 *
 * `organic` routes to the generative engine, where fal does the geometry work
 * and model calls are incidental — its budget is small because its model usage
 * should be.
 */
const TIER_BUDGETS: Record<CadTier, CadTierBudget> = {
  simple: {
    effortCap: "medium",
    agenticMaxMs: 300_000,
    maxToolTurns: 8,
    maxAttempts: 2,
    maxTokens: 400_000,
  },
  complex: {
    // "max" is the top of the ladder, i.e. no clamp — every role keeps the
    // effort its own table entry asks for.
    effortCap: "max",
    agenticMaxMs: 600_000,
    maxToolTurns: 16,
    maxAttempts: 4,
    maxTokens: 1_500_000,
  },
  organic: {
    effortCap: "medium",
    agenticMaxMs: 300_000,
    maxToolTurns: 8,
    maxAttempts: 2,
    maxTokens: 300_000,
  },
};

const storage = new AsyncLocalStorage<CadTier>();

/**
 * Adaptive budgets are on by default; `CAD_ADAPTIVE_BUDGETS=false` restores
 * the pre-tier behavior wholesale (fixed effort table, 600s, 16 turns, 4
 * attempts) without touching any other env var — the one switch to flip if a
 * tier turns out to be starving real builds.
 */
export function adaptiveBudgetsEnabled(): boolean {
  return process.env.CAD_ADAPTIVE_BUDGETS !== "false";
}

/** Run `fn` with `tier` active for every call it makes. */
export function runWithCadTier<T>(tier: CadTier, fn: () => T): T {
  return storage.run(tier, fn);
}

/** The active tier, or undefined outside a tiered run. */
export function activeCadTier(): CadTier | undefined {
  return adaptiveBudgetsEnabled() ? storage.getStore() : undefined;
}

/**
 * The active tier's budget, or undefined when no tier is active. Callers use
 * the undefined case to keep their own historical default, so that an
 * untiered run (eval runner, legacy path) is unchanged.
 */
export function activeTierBudget(): CadTierBudget | undefined {
  const tier = activeCadTier();
  return tier ? TIER_BUDGETS[tier] : undefined;
}

/** A tier's budget, for tests and for callers that know their tier. */
export function tierBudget(tier: CadTier): CadTierBudget {
  return TIER_BUDGETS[tier];
}

function envInt(name: string): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const TIER_TOKEN_ENV: Record<CadTier, string> = {
  simple: "CAD_MAX_TOKENS_SIMPLE",
  complex: "CAD_MAX_TOKENS_COMPLEX",
  organic: "CAD_MAX_TOKENS_ORGANIC",
};

/**
 * The token ceiling for a tier: the global override, else that tier's
 * override, else the tier default. Untiered runs get the global override only
 * — there is no complexity signal to pick a tier default from, so an eval run
 * stays unbounded unless the operator says otherwise.
 */
export function tokenCeilingForTier(
  tier: CadTier | undefined
): number | undefined {
  const global = envInt("CAD_MAX_TOKENS_PER_JOB");
  if (global !== undefined) return global;
  if (!tier || !adaptiveBudgetsEnabled()) return undefined;
  return envInt(TIER_TOKEN_ENV[tier]) ?? TIER_BUDGETS[tier].maxTokens;
}

/** The token ceiling in force for the active tier. */
export function tokenCeiling(): number | undefined {
  return tokenCeilingForTier(activeCadTier());
}

/**
 * Repair attempts and agentic tool turns the active tier allows, each with a
 * global override.
 *
 * The overrides exist so a tier that turns out too tight has a lever that is
 * not "switch tiering off entirely" — losing the effort savings to fix an
 * attempt count would be a bad trade, and is exactly the kind of all-or-
 * nothing escape hatch operators end up leaving flipped. They mirror
 * CAD_AGENTIC_MAX_MS, which has always overridden the wall budget the same
 * way. Undefined when no tier is active, so the caller keeps its own default.
 */
export function attemptBudget(): number | undefined {
  return envInt("CAD_MAX_ATTEMPTS") ?? activeTierBudget()?.maxAttempts;
}

export function toolTurnBudget(): number | undefined {
  return envInt("CAD_MAX_TOOL_TURNS") ?? activeTierBudget()?.maxToolTurns;
}

/**
 * The tier behind a route label, for callers that can see the routing verdict
 * but not the async context that carried it — the job executor watches the
 * `route` progress event for exactly this reason (lib/cad/jobs.ts).
 *
 * Mirrors ./orchestrate's own labels: `simple`, `simple-bestofN`, `complex`,
 * `organic`. Anything else — every `legacy*` route, an unrecognized label from
 * an older persisted job — is untiered, which is the same answer the
 * orchestrator gives by not wrapping those paths in a tier at all.
 */
export function tierForRoute(route: string | undefined): CadTier | undefined {
  if (!route) return undefined;
  if (route.startsWith("simple")) return "simple";
  if (route.startsWith("complex")) return "complex";
  if (route.startsWith("organic")) return "organic";
  return undefined;
}

/**
 * Model tokens this generation has spent so far — input + output across every
 * role, read from the active meter (./metering). Zero outside a metered run,
 * which is what keeps this inert for scripts and tests.
 */
export function tokensSpent(): number {
  return activeCadContext()?.meter?.totalModelTokens() ?? 0;
}

/**
 * True once the generation has spent its token ceiling.
 *
 * Checked BETWEEN units of work — before another agentic turn, before another
 * repair attempt — so the loops stop gracefully and keep whatever they have
 * built. A single in-flight call is never interrupted by this; the per-call
 * `max_tokens` caps bound that overshoot to one call's worth.
 */
export function budgetExhausted(): boolean {
  const ceiling = tokenCeiling();
  return ceiling !== undefined && tokensSpent() >= ceiling;
}

/**
 * Raised by the executor's backstop when a generation blows through its token
 * ceiling. Distinct from a harness failure because the cause and the remedy
 * are different: nothing is broken, the job was too expensive, and the user
 * should be told that rather than "generation failed".
 */
export class CadBudgetExceededError extends Error {
  readonly spent: number;
  readonly ceiling: number;

  constructor(spent: number, ceiling: number) {
    super(
      `CAD token budget exceeded: ${spent.toLocaleString()} tokens spent against a ceiling of ${ceiling.toLocaleString()}`
    );
    this.name = "CadBudgetExceededError";
    this.spent = spent;
    this.ceiling = ceiling;
  }
}
