import type { CadUsageSummary } from "@/lib/cad/types";

/**
 * Unit pricing for studio generation costs (MTR-181,
 * docs/text-to-cad/08-monetization.md).
 *
 * Every price is env-tunable and DEFAULTS TO 0, so the shipped state is
 * metering-only: cadJobs.usage records raw signals, cadJobs.costCents lands
 * as 0, and nothing customer-visible exists. Setting real unit prices is an
 * owner decision — flip the env vars, and both new rollups and read-time
 * recomputation (computeCostCents over persisted usage) pick them up.
 *
 * Env vars (all integers/JSON, cents):
 *   CAD_PRICE_MTOK_INPUT_CENTS        cents per 1M input tokens
 *   CAD_PRICE_MTOK_OUTPUT_CENTS       cents per 1M output tokens
 *   CAD_PRICE_MTOK_CACHE_READ_CENTS   cents per 1M cache-read tokens
 *   CAD_PRICE_MTOK_CACHE_WRITE_CENTS  cents per 1M cache-write tokens
 *   CAD_PRICE_MODEL_JSON              per-model-id overrides, e.g.
 *     {"claude-sonnet-4-6":{"inputCents":300,"outputCents":1500}}
 *   CAD_PRICE_SIDECAR_MINUTE_CENTS    cents per sidecar wall-clock minute
 *   CAD_PRICE_FAL_CALL_CENTS          cents per fal invocation (default)
 *   CAD_PRICE_FAL_JSON                per-fal-model overrides, e.g.
 *     {"fal-ai/hunyuan3d/v2":16,"fal-ai/flux/schnell":1}
 *
 * BYOK note: when real BYOK lands, user-keyed model tokens should be priced
 * at 0 (the user pays their provider directly) while sidecar/fal components
 * still count — that branch keys off usage rows' credential source, a field
 * to add when MTR-187 unblocks BYOK. Not modeled yet on purpose.
 *
 * Pure (no `server-only`, env read at call time) so tests, scripts, and the
 * eval runner can import and recompute freely.
 */

/** Per-model token-price override (cents per 1M tokens). */
export interface ModelPriceOverride {
  inputCents?: number;
  outputCents?: number;
  cacheReadCents?: number;
  cacheWriteCents?: number;
}

export interface CadUnitPrices {
  /** Cents per 1M input tokens (global default across models). */
  inputCentsPerMTok: number;
  /** Cents per 1M output tokens. */
  outputCentsPerMTok: number;
  /** Cents per 1M cache-read input tokens. */
  cacheReadCentsPerMTok: number;
  /** Cents per 1M cache-write (cache-creation) input tokens. */
  cacheWriteCentsPerMTok: number;
  /** Per-model-id overrides of the four token prices. */
  modelOverrides: Record<string, ModelPriceOverride>;
  /** Cents per minute of sidecar wall time. */
  sidecarCentsPerMinute: number;
  /** Cents per fal invocation when the model has no override. */
  falCentsPerCall: number;
  /** Per-fal-model flat cents per invocation. */
  falCentsByModel: Record<string, number>;
}

function num(name: string, env: NodeJS.ProcessEnv): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function jsonMap<T>(name: string, env: NodeJS.ProcessEnv): Record<string, T> {
  const raw = env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, T>)
      : {};
  } catch {
    // A malformed price map must never break a generation — price as 0.
    return {};
  }
}

/** Read the unit prices currently in force. All defaults are 0. */
export function unitPricesFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CadUnitPrices {
  return {
    inputCentsPerMTok: num("CAD_PRICE_MTOK_INPUT_CENTS", env),
    outputCentsPerMTok: num("CAD_PRICE_MTOK_OUTPUT_CENTS", env),
    cacheReadCentsPerMTok: num("CAD_PRICE_MTOK_CACHE_READ_CENTS", env),
    cacheWriteCentsPerMTok: num("CAD_PRICE_MTOK_CACHE_WRITE_CENTS", env),
    modelOverrides: jsonMap<ModelPriceOverride>("CAD_PRICE_MODEL_JSON", env),
    sidecarCentsPerMinute: num("CAD_PRICE_SIDECAR_MINUTE_CENTS", env),
    falCentsPerCall: num("CAD_PRICE_FAL_CALL_CENTS", env),
    falCentsByModel: jsonMap<number>("CAD_PRICE_FAL_JSON", env),
  };
}

const MTOK = 1_000_000;

/**
 * Roll a persisted usage summary up to cents at the given unit prices
 * (default: the env prices in force right now). Fractional cents accumulate
 * across components and round HALF-UP once at the end, so many small calls
 * don't each round to 0.
 *
 * This is the designated recompute point: cadJobs.costCents is only the
 * at-termination snapshot; anything price-sensitive should call this over
 * cadJobs.usage instead.
 */
export function computeCostCents(
  usage: CadUsageSummary | null | undefined,
  prices: CadUnitPrices = unitPricesFromEnv()
): number {
  if (!usage) return 0;
  let cents = 0;

  for (const m of usage.model ?? []) {
    const o = prices.modelOverrides[m.model] ?? {};
    cents += ((m.inputTokens || 0) / MTOK) * (o.inputCents ?? prices.inputCentsPerMTok);
    cents += ((m.outputTokens || 0) / MTOK) * (o.outputCents ?? prices.outputCentsPerMTok);
    cents +=
      ((m.cacheReadTokens || 0) / MTOK) *
      (o.cacheReadCents ?? prices.cacheReadCentsPerMTok);
    cents +=
      ((m.cacheWriteTokens || 0) / MTOK) *
      (o.cacheWriteCents ?? prices.cacheWriteCentsPerMTok);
  }

  cents += ((usage.sidecar?.ms || 0) / 60_000) * prices.sidecarCentsPerMinute;

  for (const f of usage.fal ?? []) {
    const perCall = prices.falCentsByModel[f.model] ?? prices.falCentsPerCall;
    cents += (f.calls || 0) * perCall;
  }

  return Math.round(cents);
}
