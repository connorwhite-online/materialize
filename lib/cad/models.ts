/**
 * Per-role model registry for the text-to-CAD harness — the "routing-ready"
 * plumbing. Each step of the harness (plan, implement, repair, critique,
 * title) resolves its model independently, so model assignments can be A/B'd
 * via env config without code changes.
 *
 * Resolution order per role: role-specific env -> global CAD_MODEL_DEFAULT ->
 * the role's default below. Routing to a cheaper/specialized model is a config
 * change, informed by the per-role telemetry the harness records.
 *
 * This module also owns the two request knobs the harness spent its first year
 * leaving unset — adaptive thinking and effort (`modelParamsForRole`) — because
 * both are MODEL-GATED, and the same env vars that let you re-route a role are
 * what can point it at a model that rejects them.
 *
 * A role's model also decides its VENDOR (./provider): `CAD_MODEL_IMPLEMENT=
 * gpt-6-astra` routes that role through the OpenAI Responses API, and the
 * defaults below follow whichever provider the environment is credentialed
 * for. Effort is the one knob both vendors share — `low | medium | high |
 * xhigh | max` is the same ladder on Claude's `output_config.effort` and on
 * OpenAI's `reasoning.effort`, so the per-role effort table below means the
 * same thing whichever vendor serves the role.
 *
 * Pure (no `server-only`) so the eval runner and tests can use it.
 */

import {
  defaultProvider,
  providerForModel,
  type CadProvider,
} from "./provider";

export type CadRole =
  | "plan"
  | "brief"
  | "implement"
  | "repair"
  | "critique"
  | "title";

const ROLE_ENV: Record<CadRole, string> = {
  plan: "CAD_MODEL_PLAN",
  brief: "CAD_MODEL_BRIEF",
  implement: "CAD_MODEL_IMPLEMENT",
  repair: "CAD_MODEL_REPAIR",
  critique: "CAD_MODEL_CRITIQUE",
  title: "CAD_MODEL_TITLE",
};

export type CadEffort = "low" | "medium" | "high" | "xhigh" | "max";

const ROLE_EFFORT_ENV: Record<CadRole, string> = {
  plan: "CAD_EFFORT_PLAN",
  brief: "CAD_EFFORT_BRIEF",
  implement: "CAD_EFFORT_IMPLEMENT",
  repair: "CAD_EFFORT_REPAIR",
  critique: "CAD_EFFORT_CRITIQUE",
  title: "CAD_EFFORT_TITLE",
};

/**
 * Default model per role, per provider. Everything that writes or repairs
 * geometry stays on ONE strong model on purpose: prompt caches are
 * model-scoped on both vendors, so a per-role cascade would fragment the
 * byte-stable prefix MTR-221/222 built. Trade cost with EFFORT below before
 * trading it with a cheaper model.
 *
 * Two roles diverge deliberately, and they diverge WITHIN each provider so
 * the rule survives a single-vendor deployment:
 *   - `critique` must NOT be the model that generated the part. A judge
 *     scoring its own output shows self-preference bias (the reason recorded
 *     in lib/cad/critique.ts) — a mitigation that was inert while every role
 *     resolved to the same id. It carries its own system prompt
 *     (CRITIQUE_RUBRIC), so diverging costs no cache reuse.
 *   - `title` names a finished part in one line; nothing is bought by
 *     spending a frontier model on it.
 */
const ROLE_DEFAULT_MODEL: Record<CadProvider, Record<CadRole, string>> = {
  anthropic: {
    plan: "claude-opus-5",
    brief: "claude-opus-5",
    implement: "claude-opus-5",
    repair: "claude-opus-5",
    critique: "claude-sonnet-5",
    title: "claude-haiku-4-5",
  },
  openai: {
    plan: "gpt-6-astra",
    brief: "gpt-6-astra",
    implement: "gpt-6-astra",
    repair: "gpt-6-astra",
    critique: "gpt-5.6-sol",
    title: "gpt-5.6-luna",
  },
};

/**
 * Default effort per role — the first cost lever, applied WITHIN one model.
 * Codegen and repair are the roles that repay depth (multi-constraint spatial
 * reasoning: does this fillet radius fit the local wall, does this boolean
 * sequence stay manifold); planning and naming do not.
 */
const ROLE_DEFAULT_EFFORT: Record<CadRole, CadEffort> = {
  plan: "medium",
  brief: "medium",
  implement: "xhigh",
  repair: "xhigh",
  critique: "high",
  title: "low",
};

/** Models that accept `thinking: { type: "adaptive" }`. */
const ADAPTIVE_THINKING =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-7|opus-4-6|sonnet-5|sonnet-4-6)/;
/** Models that accept `output_config.effort` at all. */
const SUPPORTS_EFFORT =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-7|opus-4-6|opus-4-5|sonnet-5|sonnet-4-6)/;
/** Models whose effort scale includes `xhigh` (added with Opus 4.7). */
const SUPPORTS_XHIGH =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-7|sonnet-5)/;

/**
 * OpenAI models that take `reasoning: { effort }` — the reasoning families.
 * A chat-tuned or non-reasoning id (gpt-4o, gpt-4.1, `*-chat-latest`)
 * rejects the field, so the same "an id this doesn't recognize gets neither
 * knob" degradation the Claude gates give applies here too.
 */
const OPENAI_REASONING = /^(gpt-6|gpt-5(\.|-)|o[1-9](-|$)|codex-)/;
/** Chat-tuned snapshots inside those families, which do NOT reason. */
const OPENAI_CHAT_TUNED = /-chat(-|$)/;
/**
 * OpenAI models whose effort ladder reaches the top rungs. `max` arrived with
 * GPT-5.6 Sol and is a flagship-only setting, so a role pointed at a smaller
 * tier (Terra, Luna, mini, nano) clamps to `high` rather than 400ing.
 */
const OPENAI_TOP_EFFORT = /^(gpt-6|gpt-5\.6-sol|gpt-5\.5-pro|gpt-5-pro|gpt-5\.1-codex-max)/;

const CAD_ROLES = new Set<string>(Object.keys(ROLE_ENV));

/**
 * Coerce a free-form telemetry role label to a CadRole. The harness meters a
 * few labels that are not roles in the routing sense ("route", "other"); they
 * are cheap classifier-style calls, so they take the plan role's params —
 * which is the model they were already resolving by hand at the call site.
 */
export function cadRoleOrDefault(role: string | undefined): CadRole {
  return role && CAD_ROLES.has(role) ? (role as CadRole) : "plan";
}

/** The model id for a role. */
export function modelForRole(role: CadRole): string {
  return (
    process.env[ROLE_ENV[role]] ||
    process.env.CAD_MODEL_DEFAULT ||
    ROLE_DEFAULT_MODEL[defaultProvider()][role]
  );
}

/** The vendor that serves a role's resolved model. */
export function providerForRole(role: CadRole): CadProvider {
  return providerForModel(modelForRole(role));
}

const EFFORTS: readonly CadEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function effortForRole(role: CadRole): CadEffort {
  const raw = (
    process.env[ROLE_EFFORT_ENV[role]] ||
    process.env.CAD_EFFORT_DEFAULT ||
    ""
  ).toLowerCase();
  return (EFFORTS as readonly string[]).includes(raw)
    ? (raw as CadEffort)
    : ROLE_DEFAULT_EFFORT[role];
}

/** Request params for a role: the model plus the knobs it actually supports. */
export interface CadModelParams {
  model: string;
  thinking?: { type: "adaptive" };
  output_config?: { effort: CadEffort };
}

/**
 * Resolve a role to the exact request params to spread into
 * `messages.create`. Both knobs are gated on what the RESOLVED model accepts,
 * because a CAD_MODEL_* override can point a role at a model that 400s on
 * them: Haiku 4.5 and older take `budget_tokens` and reject `adaptive`, and
 * `xhigh` did not exist before Opus 4.7 (it clamps to `high` there rather
 * than failing the call). A model this doesn't recognize — a new id, a
 * snapshot suffix — gets neither knob, so an unknown override degrades to
 * today's behavior instead of erroring.
 */
export function modelParamsForRole(role: CadRole): CadModelParams {
  const model = modelForRole(role);
  const params: CadModelParams = { model };
  if (ADAPTIVE_THINKING.test(model)) params.thinking = { type: "adaptive" };
  if (SUPPORTS_EFFORT.test(model)) {
    const effort = effortForRole(role);
    params.output_config = {
      effort:
        effort === "xhigh" && !SUPPORTS_XHIGH.test(model) ? "high" : effort,
    };
  }
  return params;
}

/** Request params for a role on the OpenAI Responses API. */
export interface OpenAiModelParams {
  model: string;
  reasoning?: { effort: CadEffort };
}

/**
 * The OpenAI-side twin of `modelParamsForRole`: the same per-role effort
 * table, expressed as `reasoning.effort`, gated on what the resolved model
 * accepts. `thinking` has no counterpart — a reasoning model on the Responses
 * API always reasons, and effort is how much.
 */
export function openaiParamsForRole(role: CadRole): OpenAiModelParams {
  const model = modelForRole(role);
  const params: OpenAiModelParams = { model };
  if (OPENAI_REASONING.test(model) && !OPENAI_CHAT_TUNED.test(model)) {
    const effort = effortForRole(role);
    const top = OPENAI_TOP_EFFORT.test(model);
    params.reasoning = {
      effort: !top && (effort === "xhigh" || effort === "max") ? "high" : effort,
    };
  }
  return params;
}

/**
 * Plan-then-code: emit a short design plan before writing build123d. On by
 * default (decomposition/CoT lifts code quality); set CAD_PLAN_STEP=false to
 * skip the extra model call. No-op without model credentials regardless.
 */
export function planStepEnabled(): boolean {
  return process.env.CAD_PLAN_STEP !== "false";
}

/**
 * Design-brief step (docs/text-to-cad/06 part 1): a structured JSON
 * intermediate between prompt and code, built on fresh builds alongside the
 * plan. On by default; set CAD_BRIEF_STEP=false to skip the extra model call.
 * Best-effort regardless — a brief failure never blocks generation.
 */
export function briefStepEnabled(): boolean {
  return process.env.CAD_BRIEF_STEP !== "false";
}
